const button = document.getElementById('grant');
const result = document.getElementById('result');

async function check() {
  try {
    const p = await navigator.permissions.query({ name: 'microphone' });
    if (p.state === 'granted') done();
    p.onchange = () => p.state === 'granted' && done();
  } catch {}
}

function done() {
  button.disabled = true;
  button.textContent = 'Microphone allowed';
  result.textContent = 'All set. You can close this tab and start dictating.';
  result.className = 'ok';
  chrome.runtime.sendMessage({ type: 'preload' });
}

button.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    done();
  } catch (err) {
    result.className = 'err';
    result.textContent = err.name === 'NotFoundError'
      ? 'No microphone was found. Plug one in and try again.'
      : 'Microphone access was blocked. Click the camera/mic icon in the address bar to allow it, then try again.';
  }
});

check();
