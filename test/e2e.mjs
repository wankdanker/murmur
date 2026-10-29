// End-to-end check in real Chromium: loads the built extension, feeds a WAV
// file in as the microphone, dictates into a textarea and a contenteditable,
// and checks the transcript. Downloads the model on first run.
//
//   npm run test:e2e            (MURMUR_MODEL=moonshine-tiny to try another)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const wav = path.join(root, 'test/fixtures/speech.wav');
const EXPECT = /fellow americans.*ask not what your country can do for you/i;
const TIMEOUT = +(process.env.E2E_TIMEOUT || 240_000);

const page_html = `<!doctype html><title>Murmur test</title>
<body style="font:16px system-ui;padding:40px;max-width:640px">
<h3>Textarea</h3><textarea id="ta" rows="5" style="width:100%"></textarea>
<h3>Rich editor</h3><div id="ce" contenteditable="true" style="border:1px solid #999;min-height:90px;padding:8px"></div>
</body>`;
const server = createServer((_, res) => res.end(page_html)).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const args = [
  `--disable-extensions-except=${dist}`,
  `--load-extension=${dist}`,
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${wav}`,
  '--autoplay-policy=no-user-gesture-required',
];
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost');

const profile = await mkdtemp(path.join(tmpdir(), 'murmur-e2e-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: !process.env.HEADED,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args,
  viewport: { width: 760, height: 520 },
});

let failed = false;
try {
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  sw.on('console', (m) => console.log('[sw]', m.text()));
  if (process.env.MURMUR_MODEL) {
    await sw.evaluate((model) => chrome.storage.local.set({ settings: { model, showButton: true } }), process.env.MURMUR_MODEL);
  }
  // Surface offscreen document logs.
  ctx.on('page', (p) => p.on('console', (m) => console.log(`[${new URL(p.url()).pathname}]`, m.text())));

  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()));
  await page.goto(url);

  for (const sel of ['#ta', '#ce']) {
    const t0 = Date.now();
    await page.click(sel);
    const button = page.locator('murmur-dictation button');
    await button.waitFor({ state: 'visible', timeout: 5000 });
    await button.click();
    const read = () => page.$eval(sel, (el) => el.value ?? el.innerText);
    let text = '';
    while (Date.now() - t0 < TIMEOUT) {
      text = await read();
      if (EXPECT.test(text)) break;
      await page.waitForTimeout(500);
    }
    await button.click(); // stop
    await page.screenshot({ path: path.join(root, `test/e2e-${sel.slice(1)}.png`) });
    const ok = EXPECT.test(text);
    failed ||= !ok;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${sel} in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${JSON.stringify(text)}`);
    await page.waitForTimeout(1500);
  }
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await ctx.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
