// Speech models Murmur can run. All weights come from the Hugging Face Hub on
// first use and are cached by the browser; inference is local.

export const MODELS = {
  'moonshine-base': {
    label: 'Moonshine Base (English, recommended)',
    repo: 'onnx-community/moonshine-base-ONNX',
    size: { webgpu: '~150 MB', wasm: '~63 MB' },
    dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: 'q8' },
  },
  'moonshine-tiny': {
    label: 'Moonshine Tiny (English, fastest)',
    repo: 'onnx-community/moonshine-tiny-ONNX',
    size: { webgpu: '~76 MB', wasm: '~28 MB' },
    dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: 'q8' },
  },
  'whisper-base': {
    label: 'Whisper Base (multilingual)',
    repo: 'onnx-community/whisper-base',
    size: { webgpu: '~140 MB', wasm: '~77 MB' },
    dtype: { webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, wasm: 'q8' },
    whisper: true,
  },
  'whisper-large-v3-turbo': {
    label: 'Whisper Large v3 Turbo (multilingual, best, needs WebGPU)',
    repo: 'onnx-community/whisper-large-v3-turbo',
    size: { webgpu: '~560 MB' },
    dtype: { webgpu: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' } },
    whisper: true,
    webgpuOnly: true,
  },
};

export const DEFAULT_MODEL = 'moonshine-base';

export const DEFAULT_SETTINGS = {
  model: DEFAULT_MODEL,
  showButton: true,
  language: '', // Whisper only; empty means auto-detect
};
