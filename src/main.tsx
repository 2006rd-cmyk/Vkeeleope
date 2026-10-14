import { render } from 'preact';
import { hasVoice, initAudio, onVoice } from './audio';
import { loadContent } from './content';
import { Model } from './model';
import { Store } from './store';
import { App } from './ui/App';

const opened = Date.now();

async function boot() {
  const root = document.getElementById('app')!;
  let store: Store;
  try {
    store = await Store.open();
  } catch {
    root.innerHTML =
      '<div class="onboard"><h1>Saving is blocked</h1><p>This browser does not allow Vire to save progress (private mode?). Open Vire in a normal window or from the home-screen icon.</p></div>';
    return;
  }
  void initAudio();
  const course = await loadContent();
  let current: Model;
  const makeModel = async () => {
    current = new Model(course, await store.load(), store);
    current.audio = hasVoice();
    return current;
  };
  const model = await makeModel();
  // For automated tests and debugging from the browser console.
  (window as unknown as { __vire: unknown }).__vire = { get model() { return current; } };
  let session: { id: number; opened: number } | null = null;
  try {
    session = { id: await store.addSession({ opened }), opened };
  } catch {
    session = null;
  }
  const draw = () => render(<App initial={model} store={store} makeModel={makeModel} session={session} />, root);
  onVoice(() => {
    current.audio = true;
    draw();
  });
  draw();
  document.getElementById('splash')?.remove();
}

// iPhone needs one speech call inside a tap before it lets the app speak by itself.
window.addEventListener(
  'pointerdown',
  () => {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis?.speak(u);
    } catch {
      /* no speech */
    }
  },
  { once: true },
);

boot().catch((e) => {
  console.error(e);
  const root = document.getElementById('app');
  if (root) root.innerHTML = `<div class="onboard"><h1>Vire could not start</h1><p>${String(e?.message ?? e)}</p><button class="btn primary wide" onclick="location.reload()">Reload</button></div>`;
});

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/[?&]nosw/.test(location.search)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline mode unavailable', e));
  });
}
