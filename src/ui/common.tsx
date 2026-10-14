import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { Model } from '../model';
import type { Store } from '../store';
import type { RuItem } from '../types';
import { speak } from '../audio';
import { plain } from '../text';

export interface AppApi {
  model: Model;
  store: Store;
  refresh: () => void;
  /** Re-read everything from storage (after loading a backup). */
  reload: () => Promise<void>;
  /** Where the user is, for feedback notes: screen name and the exercise item id. */
  setWhere: (screen: string, item?: string) => void;
  toast: (msg: string) => void;
}

export const Api = createContext<AppApi>(null as unknown as AppApi);
export const useApi = () => useContext(Api);

export function useSettings() {
  return useApi().model.settings;
}

/** Russian text with the stress-mark setting applied; optional transliteration below. */
export function Ru({ item, translit = true, big = false, onWord }: { item: RuItem; translit?: boolean; big?: boolean; onWord?: (w: string, el: HTMLElement) => void }) {
  const s = useSettings();
  const text = s.stress ? item.stress || item.ru : plain(item.stress || item.ru);
  return (
    <span class={`ru-block${big ? ' big' : ''}`}>
      <span class="ru" lang="ru">
        {onWord ? <Tappable text={text} onWord={onWord} /> : text}
      </span>
      {translit && s.translit && item.translit ? <span class="translit">{item.translit}</span> : null}
    </span>
  );
}

function Tappable({ text, onWord }: { text: string; onWord: (w: string, el: HTMLElement) => void }) {
  const parts = text.split(/([А-Яа-яЁё́]+(?:-[А-Яа-яЁё́]+)*)/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <button type="button" class="word-tap" key={i} onClick={(e) => onWord(p, e.currentTarget as HTMLElement)}>
            {p}
          </button>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** Russian shown with the stress setting, no transliteration (for options). */
export function ruText(item: RuItem | undefined, text: string, stress: boolean): string {
  if (!item) return text;
  return stress ? item.stress || item.ru : plain(item.stress || item.ru);
}

export function SpeakBtn({ text, big = false, label = 'Play', onPlay, auto = false }: { text: string; big?: boolean; label?: string; onPlay?: () => void; auto?: boolean }) {
  const { model } = useApi();
  const s = model.settings;
  const [slow, setSlow] = useState(false);
  const played = useRef(false);
  useEffect(() => {
    if (auto && s.sound && model.audio && !played.current) {
      played.current = true;
      const t = setTimeout(() => speak(text, { slow: s.slow }), 150);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [text, auto]);
  if (!s.sound || !model.audio) return null;
  return (
    <span class="speak-wrap">
      <button
        type="button"
        class={`speak${big ? ' big' : ''}`}
        aria-label={label}
        onClick={() => {
          speak(text, { slow: slow || s.slow });
          setSlow(!slow);
          onPlay?.();
        }}
      >
        <SpeakerIcon />
      </button>
    </span>
  );
}

export function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />
    </svg>
  );
}

export function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M5 21V4h9l.4 2H20v10h-7l-.4-2H7v7H5z" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z" />
    </svg>
  );
}

export function Stars({ n, of = 3 }: { n: number; of?: number }) {
  return (
    <span class="stars" aria-label={`${n} of ${of} stars`}>
      {Array.from({ length: of }, (_, i) => (
        <span class={i < n ? 'star on' : 'star'}>★</span>
      ))}
    </span>
  );
}

export function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
