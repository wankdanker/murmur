# Murmur

A Chrome extension for dictation in any text box. Speech recognition runs in the browser with
[Transformers.js](https://huggingface.co/docs/transformers.js), so audio never leaves your machine.
No API keys and no server.

- A mic button appears on the focused text box (inputs, textareas and rich editors such as
  claude.ai, ChatGPT, Gmail, Notion and Slack).
- Text is typed as you pause, and a bubble shows the words still being spoken.
- <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> toggles dictation and <kbd>Esc</kbd> stops it.
  Change the shortcut at `chrome://extensions/shortcuts`.
- Runs on the GPU through WebGPU when it's available, otherwise on the CPU with WebAssembly.

## Models

Choose the model from the toolbar popup. The weights download from the Hugging Face Hub the first
time you dictate and are cached after that.

| Model | Languages | Download | Notes |
|---|---|---|---|
| **Moonshine Base** (default) | English | ~63 MB (CPU) / ~150 MB (GPU) | Built for live speech. Fast and accurate. |
| Moonshine Tiny | English | ~28 MB | Fastest. Good for slow machines. |
| Whisper Base | 99 languages | ~77 MB | Choose the language in the popup or let it auto-detect. |
| Whisper Large v3 Turbo | 99 languages | ~560 MB | Most accurate. WebGPU only. |

## Install

Download `murmur.zip` from the [latest build](https://github.com/wankdanker/murmur/releases/tag/latest)
(rebuilt on every push to `main`) or from a [versioned release](https://github.com/wankdanker/murmur/releases).
Unzip it, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose
the unzipped folder. To update, replace the folder's contents and press reload on the extension card.

Chrome only installs packaged `.crx` files from the Chrome Web Store, so outside the store, Load
unpacked is the way in. Publishing to the store (as unlisted, if you like) gives one-click installs
and automatic updates.

To make a versioned release, push a tag: `git tag v0.2.0 && git push origin v0.2.0`. The workflow
stamps the version into the manifest.

## Install (development)

```bash
npm install
```

```bash
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose
`dist/`. A setup tab opens and asks for microphone access once.

Run `npm run dev` to rebuild on save, then press reload on the extension card.

## How it works

```
content.js (each page)           background.js (service worker)        offscreen.html (hidden page)
  mic button, bubble   ──toggle──▶  routes messages, remembers   ──start/stop──▶  getUserMedia → AudioWorklet (16 kHz)
  inserts text         ◀─final───   which tab/frame is dictating ◀─status/text──  Segmenter (pause detection)
                                                                                  Transformers.js ASR pipeline
```

- **Offscreen document.** Manifest V3 service workers can't use the microphone or WebGPU, so a
  hidden extension page (`chrome.offscreen`, reason `USER_MEDIA`) holds the mic stream and the
  model. The model stays loaded between dictations, and the mic is released when you stop.
- **Microphone permission.** Offscreen documents can't show a permission prompt, so `setup.html`
  asks once for the extension's own origin. The extension then works on every site without
  per-site prompts.
- **Segmenting** (`src/lib/segmenter.js`). Frame energy is compared against an adaptive noise
  floor. A 700 ms pause ends an utterance, which is transcribed and inserted on its own. Long
  speech is cut every 20 s. While you speak, the utterance so far is transcribed about once a
  second for the preview bubble.
- **Insertion** (`src/content.js`, `src/lib/text.js`). Text goes in through
  `document.execCommand('insertText')`, so frameworks and rich editors see a normal user edit and
  undo works. Spacing and capitalization follow the text before the caret.
- **No remote code.** ONNX Runtime's WASM build is bundled under `dist/ort/`. The only network
  access is model downloads from `huggingface.co`.

## Tests

```bash
npm test
```

```bash
npm run test:e2e
```

`npm test` runs the unit tests for the segmenter and the text joining. `npm run test:e2e` builds
the extension, loads it into Chromium through Playwright, feeds `test/fixtures/speech.wav` in as
the microphone, dictates into a textarea and a contenteditable, and checks the transcript. The
first run downloads the model. Set `MURMUR_MODEL=moonshine-tiny` to test another model,
`CHROMIUM_PATH` to use a specific browser binary, and `HEADED=1` to watch it run.

## Packaging

`npm run package` writes `murmur.zip` from `dist/`, ready to upload to the Chrome Web Store.
