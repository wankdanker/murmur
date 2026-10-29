import { MODELS, DEFAULT_SETTINGS } from './lib/models.js';

const $ = (id) => document.getElementById(id);
const LABELS = { idle: 'Idle', starting: 'Starting', loading: 'Loading model', listening: 'Listening', transcribing: 'Finishing' };

const hasWebGPU = !!(await navigator.gpu?.requestAdapter().catch(() => null));
const { settings: stored } = await chrome.storage.local.get('settings');
const settings = { ...DEFAULT_SETTINGS, ...(stored || {}) };

for (const [key, m] of Object.entries(MODELS)) {
  const opt = new Option(m.label, key);
  if (m.webgpuOnly && !hasWebGPU) { opt.disabled = true; opt.label += ' (unavailable)'; }
  $('model').add(opt);
}
$('model').value = settings.model;
$('language').value = settings.language;
$('show-button').checked = settings.showButton;

function refresh() {
  const m = MODELS[$('model').value];
  const device = hasWebGPU ? 'webgpu' : 'wasm';
  $('model-note').textContent = `Runs on ${hasWebGPU ? 'your GPU (WebGPU)' : 'your CPU (WebAssembly)'}, ${m.size[device] ?? m.size.webgpu} one-time download.`;
  $('lang-row').hidden = !m.whisper;
}

async function save() {
  settings.model = $('model').value;
  settings.language = $('language').value;
  settings.showButton = $('show-button').checked;
  await chrome.storage.local.set({ settings });
  refresh();
}

$('model').addEventListener('change', save);
$('language').addEventListener('change', save);
$('show-button').addEventListener('change', save);
$('setup').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.sendMessage({ type: 'open-setup' }); });
$('shortcuts').addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); });

chrome.commands.getAll().then((cmds) => {
  const c = cmds.find((x) => x.name === 'toggle-dictation');
  $('shortcut').textContent = c?.shortcut || 'not set';
});

function showState(s, progress) {
  $('state').textContent = LABELS[s] + (s === 'loading' && progress != null ? ` ${Math.round(progress * 100)}%` : '');
  $('state').dataset.state = s;
}
chrome.runtime.sendMessage({ type: 'get-state' }).then((st) => showState(st?.state || 'idle'));
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target === 'popup' && msg.type === 'status') showState(msg.state, msg.progress);
});

refresh();
