// The built-in Russian keyboard (01-user-flow.md §6): nobody has to install one.
import { useEffect } from 'preact/hooks';

const ROWS = ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбюё'];

export function Keyboard({ onKey, onBack, onEnter }: { onKey: (ch: string) => void; onBack: () => void; onEnter: () => void }) {
  // A physical keyboard works too (with a Russian layout, or Enter/Backspace on any layout).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        onBack();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onEnter();
      } else if (e.key.length === 1 && /[а-яё \-?,.!]/i.test(e.key)) {
        e.preventDefault();
        onKey(e.key);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onKey, onBack, onEnter]);

  const press = (fn: () => void) => (e: Event) => {
    e.preventDefault();
    fn();
  };
  return (
    <div class="kb" role="group" aria-label="Russian keyboard">
      {ROWS.map((row, r) => (
        <div class="kb-row" key={r}>
          {[...row].map((ch) => (
            <button type="button" class="kb-key" key={ch} onPointerDown={press(() => onKey(ch))} aria-label={ch}>
              {ch}
            </button>
          ))}
          {r === 2 ? (
            <button type="button" class="kb-key kb-wide" onPointerDown={press(onBack)} aria-label="Delete">
              ⌫
            </button>
          ) : null}
        </div>
      ))}
      <div class="kb-row">
        <button type="button" class="kb-key kb-wide" onPointerDown={press(() => onKey('-'))} aria-label="hyphen">
          -
        </button>
        <button type="button" class="kb-key kb-space" onPointerDown={press(() => onKey(' '))} aria-label="space">
          пробел
        </button>
        <button type="button" class="kb-key kb-wide" onPointerDown={press(() => onKey('?'))} aria-label="question mark">
          ?
        </button>
      </div>
    </div>
  );
}
