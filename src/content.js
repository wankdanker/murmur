// Puts a mic button on the focused text box and types finished utterances
// into it.

import { joinUtterance } from './lib/text.js';

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel']);

let target = null; // element dictation types into
let savedRange = null; // caret in a contenteditable target, kept across blur
let state = 'idle';
let showButton = true;
let ui = null;

chrome.storage.local.get('settings').then(({ settings }) => {
  showButton = settings?.showButton ?? true;
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    showButton = changes.settings.newValue?.showButton ?? true;
    if (!showButton && state === 'idle') hide();
  }
});

// ---- Editable detection ------------------------------------------------

function editableRoot(el) {
  if (!el || el.nodeType !== 1) return null;
  if (el.tagName === 'TEXTAREA') return el.readOnly || el.disabled ? null : el;
  if (el.tagName === 'INPUT') {
    return TEXT_INPUT_TYPES.has((el.getAttribute('type') || '').toLowerCase()) &&
      !el.readOnly && !el.disabled ? el : null;
  }
  if (el.isContentEditable) {
    let root = el;
    while (root.parentElement?.isContentEditable) root = root.parentElement;
    return root;
  }
  return null;
}

function deepActiveElement() {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

const isTextControl = (el) => el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';

// ---- Text insertion ------------------------------------------------------

function textBeforeCaret(el) {
  if (isTextControl(el)) return el.value.slice(0, el.selectionStart ?? el.value.length);
  const sel = el.ownerDocument.getSelection();
  if (!sel?.rangeCount) return '';
  const range = sel.getRangeAt(0);
  // Only the current block matters for spacing and capitalization.
  let block = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  while (block && block !== el && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement;
  if (!block || !el.contains(block)) block = el;
  const pre = range.cloneRange();
  pre.selectNodeContents(block);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().slice(-200);
}

function restoreCaret(el) {
  if (deepActiveElement() === el) return;
  el.focus({ preventScroll: true });
  if (!isTextControl(el) && savedRange) {
    const sel = el.ownerDocument.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
}

function insertText(text) {
  const focused = editableRoot(deepActiveElement());
  const el = focused || (target?.isConnected ? target : null);
  if (!el) {
    flash('No text box to type into');
    return;
  }
  restoreCaret(el);
  const chunk = joinUtterance(textBeforeCaret(el), text);
  if (!chunk) return;

  // execCommand goes through the browser's editing pipeline, so React,
  // ProseMirror, Gmail and friends see a normal user edit (and undo works).
  if (document.execCommand('insertText', false, chunk)) return;

  if (isTextControl(el)) {
    el.setRangeText(chunk, el.selectionStart, el.selectionEnd, 'end');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: chunk }));
  } else {
    const sel = el.ownerDocument.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(chunk);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: chunk }));
  }
}

// ---- UI --------------------------------------------------------------------

const MIC_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>`;
const STOP_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>`;

const CSS = `
:host { all: initial; }
.wrap { position: fixed; z-index: 2147483647; display: flex; align-items: center; gap: 6px;
  flex-direction: row-reverse; pointer-events: none; font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; }
button { pointer-events: auto; width: 28px; height: 28px; border-radius: 50%; border: 0; padding: 0;
  display: grid; place-items: center; cursor: pointer; color: #5b5b66; background: #ffffffee;
  box-shadow: 0 1px 3px rgba(0,0,0,.25), 0 0 0 1px rgba(0,0,0,.06); transition: background .15s, color .15s, transform .1s; position: relative; }
button:hover { color: #1a1a1f; background: #fff; }
button:active { transform: scale(.94); }
button:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
.listening button { background: #e5484d; color: #fff; }
.listening button::after { content: ""; position: absolute; inset: -4px; border-radius: 50%;
  border: 2px solid #e5484d; animation: pulse 1.4s ease-out infinite; }
.busy button::before { content: ""; position: absolute; inset: -3px; border-radius: 50%;
  border: 2px solid transparent; border-top-color: #3b82f6; animation: spin .8s linear infinite; }
.bubble { pointer-events: none; max-width: 320px; padding: 5px 10px; border-radius: 12px;
  background: #1f1f24f2; color: #f2f2f5; box-shadow: 0 2px 8px rgba(0,0,0,.25);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
.bubble bdi { direction: ltr; unicode-bidi: isolate; }
.bubble[hidden] { display: none; }
.bubble.dim { color: #a8a8b3; }
@keyframes pulse { from { opacity: .7; transform: scale(.9); } to { opacity: 0; transform: scale(1.5); } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-color-scheme: dark) {
  button { background: #2a2a31ee; color: #c9c9d1; box-shadow: 0 1px 3px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08); }
  button:hover { background: #33333b; color: #fff; }
}
@media (prefers-reduced-motion: reduce) { .listening button::after, .busy button::before { animation: none; } }
`;

function buildUI() {
  const host = document.createElement('murmur-dictation');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
    <div class="wrap" hidden>
      <button type="button" title="Dictate (Alt+Shift+D)" aria-label="Start dictation">${MIC_SVG}</button>
      <div class="bubble" hidden><bdi></bdi></div>
    </div>`;
  const wrap = root.querySelector('.wrap');
  const button = root.querySelector('button');
  const bubble = root.querySelector('.bubble');
  // Keep focus (and the caret) in the text box when the button is pressed.
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });
  document.documentElement.appendChild(host);
  return { host, wrap, button, bubble, bubbleText: bubble.querySelector('bdi') };
}

function show() {
  if (!target) return;
  ui ??= buildUI();
  if (!ui.host.isConnected) document.documentElement.appendChild(ui.host);
  ui.wrap.hidden = false;
  position();
  track();
}

function hide() {
  if (ui) ui.wrap.hidden = true;
}

function position() {
  if (!ui || ui.wrap.hidden || !target) return;
  if (!target.isConnected) {
    if (state === 'idle') hide();
    return;
  }
  const r = target.getBoundingClientRect();
  const size = 28;
  const pad = r.height >= 56 ? 8 : Math.max(2, (r.height - size) / 2);
  const top = r.height >= 56 ? r.bottom - size - pad : r.top + pad;
  const right = Math.max(4, window.innerWidth - r.right + 6);
  ui.wrap.style.top = `${Math.max(4, Math.min(top, window.innerHeight - size - 4))}px`;
  ui.wrap.style.right = `${right}px`;
  ui.wrap.style.left = 'auto';
}

let tracking = false;
function track() {
  if (tracking) return;
  tracking = true;
  const tick = () => {
    if (!ui || ui.wrap.hidden) { tracking = false; return; }
    position();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let flashTimer = null;
function setBubble(text, dim = false) {
  if (!ui) return;
  clearTimeout(flashTimer);
  ui.bubble.hidden = !text;
  ui.bubble.classList.toggle('dim', dim);
  ui.bubbleText.textContent = text || '';
}

function flash(text) {
  ui ??= buildUI();
  if (target) show();
  setBubble(text);
  flashTimer = setTimeout(() => {
    setBubble('');
    if (state === 'idle' && editableRoot(deepActiveElement()) !== target) hide();
  }, 3500);
}

function render(extra = {}) {
  if (!ui) return;
  const active = state !== 'idle';
  ui.wrap.classList.toggle('listening', state === 'listening');
  ui.wrap.classList.toggle('busy', ['starting', 'loading', 'transcribing'].includes(state));
  ui.button.innerHTML = active ? STOP_SVG : MIC_SVG;
  ui.button.setAttribute('aria-label', active ? 'Stop dictation' : 'Start dictation');
  ui.button.setAttribute('aria-pressed', String(active));
  if (state === 'loading') {
    const pct = extra.progress != null ? ` ${Math.round(extra.progress * 100)}%` : '';
    setBubble(`Loading speech model${pct}…`, true);
  } else if (state === 'starting') {
    setBubble('Starting…', true);
  } else if (state === 'listening' && extra.fresh) {
    setBubble('Listening…', true);
  } else if (state === 'transcribing') {
    setBubble('Finishing…', true);
  } else if (state === 'idle') {
    setBubble('');
    if (editableRoot(deepActiveElement()) !== target) hide();
  }
}

// ---- Control ---------------------------------------------------------------

function toggle() {
  const el = editableRoot(deepActiveElement());
  if (el) target = el;
  if (!target && state === 'idle') return;
  if (state === 'idle') show();
  chrome.runtime.sendMessage({ type: 'toggle' });
}

document.addEventListener('focusin', () => {
  const el = editableRoot(deepActiveElement());
  if (!el) return;
  // Clicking into another field mid-dictation moves the dictation there.
  target = el;
  savedRange = null;
  if (showButton || state !== 'idle') show();
}, true);

document.addEventListener('focusout', () => {
  if (target && !isTextControl(target)) {
    const sel = target.ownerDocument.getSelection();
    if (sel?.rangeCount && target.contains(sel.getRangeAt(0).startContainer)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  }
  setTimeout(() => {
    if (state === 'idle' && !editableRoot(deepActiveElement())) hide();
  }, 150);
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state !== 'idle') chrome.runtime.sendMessage({ type: 'stop' });
}, true);

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'command-toggle':
      if (document.hasFocus() && editableRoot(deepActiveElement())) toggle();
      break;
    case 'status': {
      const fresh = msg.state !== state;
      state = msg.state;
      if (state !== 'idle') show();
      render({ ...msg, fresh });
      break;
    }
    case 'partial':
      if (state === 'listening') setBubble(msg.text || 'Listening…', !msg.text);
      break;
    case 'final':
      insertText(msg.text);
      break;
    case 'error':
      state = 'idle';
      render();
      flash(msg.message || 'Dictation failed');
      break;
  }
});
