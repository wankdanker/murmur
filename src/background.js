// Service worker: routes between the page that is dictating (content script)
// and the offscreen document that records and transcribes.

import { DEFAULT_SETTINGS } from './lib/models.js';

const OFFSCREEN_URL = 'offscreen.html';

// The service worker can be suspended between events; keep routing state in
// session storage so a restart doesn't orphan an active dictation.
async function getState() {
  const { murmur } = await chrome.storage.session.get('murmur');
  return murmur || { state: 'idle', target: null, session: 0 };
}

async function setState(patch) {
  const next = { ...(await getState()), ...patch };
  await chrome.storage.session.set({ murmur: next });
  return next;
}

let creating = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Record microphone audio for on-device speech recognition.',
    })
    .finally(() => { creating = null; });
  await creating;
}

async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

function toTarget(target, msg) {
  if (!target) return;
  chrome.tabs.sendMessage(target.tabId, msg, { frameId: target.frameId }).catch(() => {});
}

function broadcast(msg) {
  // Popup, if open.
  chrome.runtime.sendMessage({ target: 'popup', ...msg }).catch(() => {});
}

async function start(target) {
  const st = await getState();
  const session = st.session + 1;
  // Remember recent sessions' targets so text still being transcribed after a
  // switch lands where it was dictated.
  const targets = { ...(st.targets || {}), [session]: target };
  for (const k of Object.keys(targets)) if (+k < session - 4) delete targets[k];
  await setState({ state: 'starting', target, session, targets });
  toTarget(target, { type: 'status', state: 'starting' });
  await ensureOffscreen();
  chrome.runtime.sendMessage({
    target: 'offscreen', type: 'start', session, settings: await getSettings(),
  });
}

async function stop() {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
}

async function toggle(target) {
  const st = await getState();
  const active = st.state !== 'idle';
  const same = st.target && target &&
    st.target.tabId === target.tabId && st.target.frameId === target.frameId;
  if (active) {
    await stop();
    if (same || !target) return;
    // Dictation moves to the new field once the old one has drained.
    toTarget(st.target, { type: 'status', state: 'idle' });
  }
  if (target) await start(target);
}

function openSetup() {
  chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'background') {
    // From the offscreen document.
    (async () => {
      const st = await getState();
      if (msg.type === 'final' && msg.session) {
        toTarget(st.targets?.[msg.session] ?? st.target, msg);
        return;
      }
      if (msg.session && msg.session !== st.session) return; // stale
      if (msg.type === 'status') {
        await setState({ state: msg.state });
        broadcast(msg);
      }
      if (msg.type === 'error' && msg.code === 'mic-permission') openSetup();
      if (msg.type === 'error') broadcast(msg);
      toTarget(st.target, msg);
    })();
    return;
  }

  // From content scripts and extension pages.
  switch (msg?.type) {
    case 'toggle':
      toggle(sender.tab ? { tabId: sender.tab.id, frameId: sender.frameId } : null);
      break;
    case 'stop':
      stop();
      break;
    case 'get-state':
      getState().then(sendResponse);
      return true;
    case 'preload':
      ensureOffscreen().then(async () => {
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'preload', model: (await getSettings()).model });
      });
      break;
    case 'open-setup':
      openSetup();
      break;
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-dictation' || !tab?.id) return;
  const st = await getState();
  if (st.state !== 'idle') return stop();
  // The frame that has focus answers by sending 'toggle' itself.
  chrome.tabs.sendMessage(tab.id, { type: 'command-toggle' }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const st = await getState();
  if (st.target?.tabId === tabId && st.state !== 'idle') stop();
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
  if (reason === 'install') openSetup();
});

chrome.runtime.onStartup.addListener(() => setState({ state: 'idle', target: null }));
