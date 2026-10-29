// Hidden extension page that owns the microphone and the speech model.
// Receives start/stop from the service worker and reports status, interim
// text and finished utterances back to it.

import { pipeline, env } from '@huggingface/transformers';
import { MODELS, DEFAULT_MODEL } from './lib/models.js';
import { Segmenter } from './lib/segmenter.js';

env.allowLocalModels = false;
// The ONNX runtime is bundled with the extension; MV3 forbids loading code
// from a CDN.
env.backends.onnx.wasm.wasmPaths = {
  mjs: chrome.runtime.getURL('ort/ort-wasm-simd-threaded.asyncify.mjs'),
  wasm: chrome.runtime.getURL('ort/ort-wasm-simd-threaded.asyncify.wasm'),
};

const SAMPLE_RATE = 16000;
const PARTIAL_INTERVAL_MS = 900;

let model = null; // { key, asr, spec, device }
let loading = null; // Promise of model for `loadingKey`
let loadingKey = null;

let mic = null; // { stream, ctx, node }
let segmenter = null;
let session = 0;
let settings = {};
const finals = [];
let busy = false;
let ready = false; // the selected model is loaded for this session
let stopping = false;
let partialTimer = null;

function send(type, data = {}) {
  chrome.runtime.sendMessage({ target: 'background', type, session, ...data }).catch(() => {});
}

function status(state, extra = {}) {
  send('status', { state, ...extra });
}

async function pickDevice(spec) {
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter) return 'webgpu';
  } catch {}
  if (spec.webgpuOnly) throw new Error(`${spec.label} needs WebGPU, which isn't available here.`);
  return 'wasm';
}

async function loadModel(key) {
  const spec = MODELS[key] ? MODELS[key] : MODELS[DEFAULT_MODEL];
  key = MODELS[key] ? key : DEFAULT_MODEL;
  if (model?.key === key) return model;
  if (loading && loadingKey === key) return loading;

  loadingKey = key;
  loading = (async () => {
    const files = new Map();
    let lastSent = 0;
    const progress_callback = (p) => {
      if (p.status === 'progress' && p.file && p.total) {
        files.set(p.file, { loaded: p.loaded, total: p.total });
        const now = Date.now();
        if (now - lastSent < 150) return;
        lastSent = now;
        if (!mic) return; // nobody is waiting on this load
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        status('loading', { progress: total ? loaded / total : 0, model: spec.label });
      }
    };

    status('loading', { progress: 0, model: spec.label });
    let device = await pickDevice(spec);
    let asr;
    try {
      asr = await pipeline('automatic-speech-recognition', spec.repo, {
        device, dtype: spec.dtype[device], progress_callback,
      });
    } catch (err) {
      if (device !== 'webgpu' || spec.webgpuOnly) throw err;
      console.warn('[murmur] WebGPU load failed, falling back to WASM', err);
      device = 'wasm';
      asr = await pipeline('automatic-speech-recognition', spec.repo, {
        device, dtype: spec.dtype.wasm, progress_callback,
      });
    }
    if (model) await model.asr.dispose?.();
    model = { key, asr, spec, device };
    return model;
  })();

  try {
    return await loading;
  } finally {
    if (loadingKey === key) { loading = null; loadingKey = null; }
  }
}

async function transcribe(audio) {
  const { asr, spec } = model;
  const seconds = audio.length / SAMPLE_RATE;
  const opts = spec.whisper
    ? { task: 'transcribe', ...(settings.language ? { language: settings.language } : {}) }
    // Moonshine has no end-of-audio limit of its own and can loop on noise;
    // cap tokens at a generous speaking rate.
    : { max_new_tokens: Math.ceil(seconds * 8) + 10 };
  const out = await asr(audio, opts);
  return (out?.text ?? '').trim();
}

async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await ctx.audioWorklet.addModule(chrome.runtime.getURL('recorder-worklet.js'));
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'recorder');
  node.port.onmessage = (e) => onAudio(e.data);
  source.connect(node);
  node.connect(ctx.destination); // outputs silence; keeps the graph pulling
  return { stream, ctx, node };
}

function stopMic() {
  if (!mic) return;
  mic.node.port.onmessage = null;
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ctx.close().catch(() => {});
  mic = null;
}

function onAudio(samples) {
  if (!segmenter) return;
  for (const audio of segmenter.push(samples)) finals.push({ audio, session });
  if (finals.length) pump();
}

async function pump() {
  if (busy || !ready) return;
  busy = true;
  try {
    while (finals.length) {
      // Tagged with its session so a drain after switching fields goes to
      // the field it was spoken for.
      const item = finals.shift();
      const text = await transcribe(item.audio);
      if (text) send('final', { text, session: item.session });
      send('partial', { text: '', session: item.session });
    }
  } catch (err) {
    console.error('[murmur] transcription failed', err);
    send('error', { message: `Transcription failed: ${err.message}` });
  } finally {
    busy = false;
  }
  if (stopping && !finals.length) {
    stopping = false;
    status('idle');
  }
}

async function partial() {
  if (busy || !ready || finals.length || !segmenter?.inSpeech) return;
  const audio = segmenter.current();
  if (!audio || audio.length < SAMPLE_RATE * 0.5) return;
  busy = true;
  try {
    const text = await transcribe(audio);
    if (segmenter?.inSpeech) send('partial', { text });
  } catch (err) {
    console.warn('[murmur] partial failed', err);
  } finally {
    busy = false;
  }
  if (finals.length) pump();
}

async function start(msg) {
  if (mic) return;
  session = msg.session;
  settings = msg.settings || {};
  stopping = false;
  try {
    // Open the mic first so the user isn't kept waiting on a permission error
    // until after a model download.
    mic = await startMic();
    ready = false;
    // Audio spoken while the model loads is queued and transcribed once ready.
    segmenter = new Segmenter();
    await loadModel(settings.model);
    if (!mic || session !== msg.session) return; // stopped or restarted while loading
    ready = true;
    status('listening', { device: model.device, model: model.spec.label });
    partialTimer = setInterval(partial, PARTIAL_INTERVAL_MS);
    pump();
  } catch (err) {
    stopMic();
    segmenter = null;
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
      send('error', { code: 'mic-permission', message: 'Microphone access is needed.' });
    } else if (err?.name === 'NotFoundError') {
      send('error', { code: 'no-mic', message: 'No microphone found.' });
    } else {
      console.error('[murmur] start failed', err);
      send('error', { message: err?.message || String(err) });
    }
    status('idle');
  }
}

function stop() {
  clearInterval(partialTimer);
  partialTimer = null;
  const wasLoading = !ready;
  stopMic();
  if (segmenter) {
    const last = segmenter.flush();
    if (last) finals.push({ audio: last, session });
    segmenter = null;
  }
  send('partial', { text: '' });
  if (wasLoading || (!busy && !finals.length)) {
    finals.length = 0;
    status('idle');
    return;
  }
  stopping = true;
  status('transcribing');
  pump();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'start') start(msg);
  else if (msg.type === 'stop') stop();
  else if (msg.type === 'preload') loadModel(msg.model).then(() => status('idle')).catch(() => {});
});

send('ready');
