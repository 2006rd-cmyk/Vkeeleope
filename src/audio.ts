// Pronunciation: the phone's own Russian voice (07-audio.md, layer 3). Pre-made clips can be
// plugged in later through `clipUrl` without changing any screen.
import { plain } from './text';

let voice: SpeechSynthesisVoice | null = null;
let ready: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function pickVoice(): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis?.getVoices() ?? [];
  const ru = all.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('ru'));
  // Prefer a local (offline) voice, then known good ones.
  const score = (v: SpeechSynthesisVoice) =>
    (v.localService ? 4 : 0) + (/milena|google|yuri|katya|natalia|svetlana|dmitry/i.test(v.name) ? 2 : 0) + (v.default ? 1 : 0);
  return ru.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Resolves true when a Russian voice exists. Voices load asynchronously on most phones. */
export function initAudio(): Promise<boolean> {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve(false);
    const tryPick = () => {
      voice = pickVoice();
      if (voice) {
        listeners.forEach((l) => l());
        resolve(true);
        return true;
      }
      return false;
    };
    if (tryPick()) return;
    window.speechSynthesis.addEventListener?.('voiceschanged', () => tryPick());
    // Some browsers never fire voiceschanged; give up waiting after 2.5 s (it may still arrive later).
    setTimeout(() => resolve(!!voice), 2500);
  });
  return ready;
}

export function hasVoice(): boolean {
  return !!voice;
}

export function onVoice(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Speak Russian text. Stress marks are removed: phone voices read them as separate symbols. */
export function speak(text: string, opts: { slow?: boolean } = {}): void {
  const t = plain(text).replace(/[«»"]/g, '');
  if (!t.trim()) return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = voice?.lang ?? 'ru-RU';
  if (voice) u.voice = voice;
  u.rate = opts.slow ? 0.6 : 0.9;
  synth.speak(u);
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel();
}
