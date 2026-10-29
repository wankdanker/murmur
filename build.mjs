// Bundles the extension into dist/. `node build.mjs --watch` rebuilds on change.
import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const out = 'dist';

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/ort`, { recursive: true });

const STATIC = ['manifest.json', 'offscreen.html', 'popup.html', 'setup.html', 'pages.css', 'recorder-worklet.js', 'icons'];
await Promise.all(STATIC.map((f) => cp(`src/${f}`, `${out}/${f}`, { recursive: true })));

// ONNX Runtime's WASM build, served from the extension instead of a CDN.
const ORT = 'node_modules/onnxruntime-web/dist';
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  await cp(`${ORT}/${f}`, `${out}/ort/${f}`);
}

const common = { bundle: true, target: 'chrome116', logLevel: 'info', legalComments: 'none', minify: !watch };
const builds = [
  { ...common, entryPoints: ['src/content.js'], outfile: `${out}/content.js`, format: 'iife' },
  {
    ...common,
    entryPoints: ['src/background.js', 'src/offscreen.js', 'src/popup.js', 'src/setup.js'],
    outdir: out,
    format: 'esm',
    // onnxruntime-web references its wasm factory through import.meta.url;
    // we point it at ort/ explicitly, so leave those imports unresolved.
    external: ['*.wasm'],
  },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
