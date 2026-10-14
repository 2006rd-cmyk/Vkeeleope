import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { checkTiles, checkTyped, type CheckResult } from '../check';
import type { Exercise, Graded } from '../lessons';
import type { Outcome } from '../model';
import { speak } from '../audio';
import { capitalize, shuffle } from '../text';
import { Keyboard } from './Keyboard';
import { CloseIcon, FlagIcon, Ru, ruText, SpeakBtn, SpeakerIcon, useApi, vibrate } from './common';

type Pending = { index: number } | { tiles: string[] } | { text: string } | null;

interface Checked extends CheckResult {
  given?: string;
}

export function Lesson({ onExit, onDone, onFlag }: { onExit: () => void; onDone: (o: Outcome) => void; onFlag: () => void }) {
  const { model, refresh, setWhere } = useApi();
  const run = model.run!;
  const ex = model.currentExercise()!;
  const [pending, setPending] = useState<Pending>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [overridden, setOverridden] = useState(false);
  const shownAt = useRef(Date.now());
  const replays = useRef(0);

  useEffect(() => {
    shownAt.current = Date.now();
    replays.current = 0;
    setPending(null);
    setChecked(null);
    setOverridden(false);
    setWhere('lesson', 'cardId' in ex && ex.cardId ? ex.cardId : ex.key.split('#')[0]);
  }, [ex.key]);

  const next = useCallback(() => {
    if (ex.t === 'intro') model.seeIntro(ex);
    const out = model.next();
    if (out) onDone(out);
    else refresh();
  }, [ex]);

  const check = useCallback(() => {
    if (checked || !pending || !isGradedEx(ex)) return;
    const secs = (Date.now() - shownAt.current) / 1000;
    let res: Checked;
    if (ex.t === 'choice' && 'index' in pending) {
      const ok = pending.index === ex.answer;
      res = { verdict: ok ? 'correct' : 'wrong', note: !ok ? ex.why : undefined, given: ex.options[pending.index]?.text };
    } else if (ex.t === 'bank' && 'tiles' in pending) {
      res = { verdict: checkTiles(pending.tiles, ex.accepted), given: pending.tiles.join(' ') };
    } else if (ex.t === 'type' && 'text' in pending) {
      res = { ...checkTyped(pending.text, ex.accepted, { allowTypo: true, nearForms: model.course.nearForms }), given: pending.text };
      if (res.verdict === 'wrong' && ex.why && !res.note) res.note = ex.why;
    } else return;
    model.answer({ verdict: res.verdict, secs, given: res.given, replays: replays.current });
    setChecked(res);
    if (res.verdict === 'wrong') vibrate(120);
    const silent = ex.t === 'choice' && (ex.mode === 'question' || ex.mode === 'meaning');
    if (model.settings.sound && model.audio && ex.show.ru && !silent) speak(ex.show.ru, { slow: model.settings.slow });
  }, [checked, pending, ex]);

  const matchDone = useCallback((wrongCards: string[], secs: number) => {
    model.answer({ verdict: wrongCards.length ? 'wrong' : 'correct', secs, wrongCards });
    next();
  }, [next]);

  const total = run.queue.length;
  const progress = Math.round((run.pos / Math.max(1, total)) * 100);
  const graded = isGradedEx(ex);

  return (
    <div class="lesson">
      <header class="lesson-top">
        <button type="button" class="icon-btn" aria-label="Close lesson (progress is kept)" onClick={onExit}>
          <CloseIcon />
        </button>
        <div class="bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div class="bar-fill" style={{ width: `${progress}%` }} />
        </div>
        <button type="button" class="icon-btn" aria-label="Send feedback" onClick={onFlag}>
          <FlagIcon />
        </button>
      </header>
      <main class="lesson-body" key={ex.key}>
        <ExerciseView ex={ex} checked={!!checked} setPending={setPending} onReplay={() => replays.current++} onMatchDone={matchDone} onEnter={check} onNext={next} />
      </main>
      {graded && ex.t !== 'match' ? (
        checked ? (
          <Feedback
            ex={ex}
            res={overridden ? { verdict: 'correct' } : checked}
            onContinue={next}
            onOverride={
              ex.t === 'type' && checked.verdict === 'wrong' && !overridden
                ? () => {
                    model.overrideLast();
                    setOverridden(true);
                  }
                : undefined
            }
          />
        ) : (
          <footer class="lesson-foot">
            {(ex.t === 'choice' && ex.mode === 'listen') || (ex.t === 'type' && ex.listen) ? (
              <button
                type="button"
                class="link-btn"
                onClick={() => {
                  model.noListen();
                  refresh();
                }}
              >
                Can't listen now
              </button>
            ) : null}
            <button type="button" class="btn primary wide" disabled={!pending} onClick={check}>
              Check
            </button>
          </footer>
        )
      ) : ex.t !== 'match' ? (
        <footer class="lesson-foot">
          <ContinueFor ex={ex} onContinue={next} />
        </footer>
      ) : null}
    </div>
  );
}

function isGradedEx(e: Exercise): e is Graded {
  return e.t === 'choice' || e.t === 'bank' || e.t === 'type' || e.t === 'match';
}

function ContinueFor({ ex, onContinue }: { ex: Exercise; onContinue: () => void }) {
  if (ex.t === 'dialogue') return null; // the dialogue has its own buttons
  return (
    <button type="button" class="btn primary wide" onClick={onContinue} autoFocus>
      {ex.t === 'note' ? 'Got it' : 'Continue'}
    </button>
  );
}

function Feedback({ ex, res, onContinue, onOverride }: { ex: Graded; res: Checked; onContinue: () => void; onOverride?: () => void }) {
  const ok = res.verdict !== 'wrong';
  const show = ex.t === 'match' ? null : ex.show;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Enter' && (e.preventDefault(), onContinue());
    const t = setTimeout(() => window.addEventListener('keydown', h), 250);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', h);
    };
  }, [onContinue]);
  const sentenceCase = ex.t === 'bank' || ex.t === 'type';
  return (
    <footer class={`feedback ${ok ? 'ok' : 'bad'}`} role="status" aria-live="polite">
      <div class="fb-title">{res.verdict === 'correct' ? 'Correct!' : res.verdict === 'almost' ? 'Almost!' : 'Not quite'}</div>
      {res.note ? <div class="fb-note">{res.note}</div> : null}
      {show && show.ru ? (
        <div class="fb-answer">
          {!ok ? <div class="fb-label">Correct answer:</div> : null}
          <div class="fb-row">
            <Ru item={sentenceCase ? { ...show, stress: capitalize(show.stress), ru: capitalize(show.ru) } : show} />
            <SpeakBtn text={show.ru} />
          </div>
          <div class="fb-en">{show.en}</div>
        </div>
      ) : show && !ok ? (
        <div class="fb-answer">
          <div class="fb-label">Correct answer:</div>
          <div class="fb-en">{show.en}</div>
        </div>
      ) : null}
      {!ok && res.given && ex.t === 'type' ? <div class="fb-given">You wrote: {res.given}</div> : null}
      <div class="fb-actions">
        {onOverride ? (
          <button type="button" class="link-btn" onClick={onOverride}>
            My answer was correct
          </button>
        ) : null}
        <button type="button" ref={ref} class={`btn wide ${ok ? 'primary' : 'danger'}`} onClick={onContinue}>
          Continue
        </button>
      </div>
    </footer>
  );
}

// ------------------------------------------------------------------ exercises

interface ViewProps {
  ex: Exercise;
  checked: boolean;
  setPending: (p: Pending) => void;
  onReplay: () => void;
  onMatchDone: (wrong: string[], secs: number) => void;
  onEnter: () => void;
  onNext: () => void;
}

function ExerciseView(p: ViewProps) {
  const { ex } = p;
  switch (ex.t) {
    case 'intro':
      return <Intro ex={ex} />;
    case 'note':
      return (
        <div class="ex note-card">
          <div class="kicker">Grammar</div>
          <h2>{ex.title}</h2>
          <p class="note-body">{ex.body}</p>
        </div>
      );
    case 'dialogue':
      return <DialogueView unit={ex.unit} onNext={p.onNext} />;
    case 'choice':
      return <Choice {...p} ex={ex} />;
    case 'match':
      return <Match ex={ex} onDone={p.onMatchDone} />;
    case 'bank':
      return <Bank {...p} ex={ex} />;
    case 'type':
      return <TypeIt {...p} ex={ex} />;
  }
}

function Intro({ ex }: { ex: Extract<Exercise, { t: 'intro' }> }) {
  return (
    <div class="ex intro">
      <div class="kicker">New word</div>
      <div class="intro-word">
        <Ru item={ex.item} big />
        <SpeakBtn text={ex.item.ru} auto big />
      </div>
      <div class="intro-en">{ex.item.en}</div>
      {ex.say ? <div class="intro-say">Sounds like: {ex.say}</div> : null}
      {ex.note ? <div class="intro-note">{ex.note}</div> : null}
    </div>
  );
}

function Choice({ ex, checked, setPending, onReplay }: ViewProps & { ex: Extract<Exercise, { t: 'choice' }> }) {
  const { model } = useApi();
  const [sel, setSel] = useState<number | null>(null);
  const stress = model.settings.stress;
  const choose = (i: number) => {
    if (checked) return;
    setSel(i);
    setPending({ index: i });
    const o = ex.options[i];
    if (o.ru && ex.mode === 'russian' && model.settings.sound) speak(o.text, { slow: model.settings.slow });
  };
  return (
    <div class="ex choice">
      <div class="prompt">{ex.prompt}</div>
      {ex.mode === 'meaning' && ex.promptRu ? (
        <div class="prompt-ru">
          <Ru item={ex.promptRu} big />
          <SpeakBtn text={ex.promptRu.ru} auto onPlay={onReplay} />
        </div>
      ) : null}
      {ex.mode === 'listen' && ex.promptRu ? (
        <div class="prompt-listen">
          <ListenBtn text={ex.promptRu.ru} onReplay={onReplay} />
        </div>
      ) : null}
      {ex.mode === 'gap' ? (
        <div class="gap">
          <div class="gap-text" lang="ru">
            {renderGap(ex.letter ?? '', sel !== null ? ex.options[sel].text : null)}
          </div>
          {ex.hint ? <div class="gap-hint">{ex.hint}</div> : null}
        </div>
      ) : null}
      <div class={`options${ex.options.every((o) => o.text.length < 14) ? ' grid' : ''}`} role="radiogroup">
        {ex.options.map((o, i) => {
          const state = checked ? (i === ex.answer ? ' right' : i === sel ? ' wrong' : ' dim') : sel === i ? ' sel' : '';
          return (
            <button
              type="button"
              role="radio"
              aria-checked={sel === i}
              class={`option${state}${o.ru || ex.mode === 'gap' ? ' is-ru' : ''}`}
              lang={o.ru || ex.mode === 'gap' ? 'ru' : undefined}
              onClick={() => choose(i)}
            >
              <span class="opt-num">{i + 1}</span>
              <span class="opt-text">{ruText(o.ru, o.text, stress)}</span>
            </button>
          );
        })}
      </div>
      <NumberKeys n={ex.options.length} onPick={(i) => choose(i)} />
    </div>
  );
}

/** Keys 1–4 pick an option on a computer. */
function NumberKeys({ n, onPick }: { n: number; onPick: (i: number) => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const d = Number(e.key);
      if (d >= 1 && d <= n) onPick(d - 1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [n, onPick]);
  return null;
}

function renderGap(prompt: string, fill: string | null) {
  const [a, b] = prompt.split('___');
  return (
    <>
      {a}
      <span class={`gap-slot${fill ? ' filled' : ''}`}>{fill ?? '    '}</span>
      {b}
    </>
  );
}

function ListenBtn({ text, onReplay }: { text: string; onReplay: () => void }) {
  const { model } = useApi();
  const first = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => speak(text, { slow: model.settings.slow }), 200);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <div class="listen-row">
      <button
        type="button"
        class="listen-btn"
        aria-label="Play again"
        onClick={() => {
          speak(text, { slow: model.settings.slow });
          if (!first.current) onReplay();
          first.current = false;
        }}
      >
        <SpeakerIcon />
      </button>
      <button type="button" class="listen-btn slow" aria-label="Play slowly" onClick={() => (speak(text, { slow: true }), onReplay())}>
        🐢
      </button>
    </div>
  );
}

function Match({ ex, onDone }: { ex: Extract<Exercise, { t: 'match' }>; onDone: (wrong: string[], secs: number) => void }) {
  const { model } = useApi();
  const stress = model.settings.stress;
  const start = useRef(Date.now());
  const right = useMemo(() => shuffle(ex.pairs.map((_, i) => i)), [ex.key]);
  const [left, setLeft] = useState<number | null>(null);
  const [rightSel, setRightSel] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [bad, setBad] = useState<[number, number] | null>(null);
  const wrong = useRef(new Set<string>());

  const tryPair = (l: number, r: number) => {
    if (l === r) {
      const d = new Set(done);
      d.add(l);
      setDone(d);
      setLeft(null);
      setRightSel(null);
      if (d.size === ex.pairs.length) {
        setTimeout(() => onDone([...wrong.current], (Date.now() - start.current) / 1000), 350);
      }
    } else {
      const id = ex.pairs[l].cardId;
      if (id) wrong.current.add(id);
      setBad([l, r]);
      vibrate(80);
      setTimeout(() => {
        setBad(null);
        setLeft(null);
        setRightSel(null);
      }, 450);
    }
  };
  const pickLeft = (i: number) => {
    if (done.has(i) || bad) return;
    setLeft(i);
    if (model.settings.sound && model.audio) speak(ex.pairs[i].left);
    if (rightSel !== null) tryPair(i, rightSel);
  };
  const pickRight = (i: number) => {
    if (done.has(i) || bad) return;
    setRightSel(i);
    if (left !== null) tryPair(left, i);
  };
  const cls = (i: number, side: 'l' | 'r') => {
    if (done.has(i)) return ' done';
    if (bad && bad[side === 'l' ? 0 : 1] === i) return ' wrong';
    if ((side === 'l' ? left : rightSel) === i) return ' sel';
    return '';
  };
  return (
    <div class="ex match">
      <div class="prompt">Tap the matching pairs</div>
      <div class="match-cols">
        <div class="match-col">
          {ex.pairs.map((p, i) => (
            <button type="button" class={`option is-ru${cls(i, 'l')}`} lang="ru" disabled={done.has(i)} onClick={() => pickLeft(i)}>
              {ruText(p.leftRu, p.left, stress)}
            </button>
          ))}
        </div>
        <div class="match-col">
          {right.map((i) => (
            <button type="button" class={`option${cls(i, 'r')}`} disabled={done.has(i)} onClick={() => pickRight(i)} data-pair={i}>
              {ex.pairs[i].right}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bank({ ex, checked, setPending }: ViewProps & { ex: Extract<Exercise, { t: 'bank' }> }) {
  const { model } = useApi();
  const [chosen, setChosen] = useState<number[]>([]);
  const update = (c: number[]) => {
    setChosen(c);
    setPending(c.length ? { tiles: c.map((i) => ex.tiles[i]) } : null);
  };
  const add = (i: number) => {
    if (checked || chosen.includes(i)) return;
    update([...chosen, i]);
    if (model.settings.sound && model.audio) speak(ex.tiles[i]);
  };
  const remove = (i: number) => !checked && update(chosen.filter((x) => x !== i));
  return (
    <div class="ex bank">
      <div class="prompt">Write this in Russian</div>
      <div class="bank-en">{ex.en}</div>
      <div class="bank-answer" aria-label="Your answer">
        {chosen.map((i, n) => (
          <button type="button" class="tile" lang="ru" onClick={() => remove(i)}>
            {n === 0 ? capitalize(ex.tiles[i]) : ex.tiles[i]}
          </button>
        ))}
      </div>
      <div class="bank-pool">
        {ex.tiles.map((t, i) => (
          <button type="button" class={`tile${chosen.includes(i) ? ' used' : ''}`} lang="ru" disabled={chosen.includes(i)} onClick={() => add(i)}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

function TypeIt({ ex, checked, setPending, onEnter, onReplay }: ViewProps & { ex: Extract<Exercise, { t: 'type' }> }) {
  const { model, refresh } = useApi();
  const [text, setText] = useState('');
  const phone = model.settings.keyboard === 'phone';
  const set = (t: string) => {
    if (checked) return;
    setText(t);
    setPending(t.trim() ? { text: t } : null);
  };
  const textRef = useRef(text);
  textRef.current = text;
  const onKey = useCallback((ch: string) => set(textRef.current + ch), [checked]);
  const onBack = useCallback(() => set(textRef.current.slice(0, -1)), [checked]);
  return (
    <div class="ex type">
      {ex.listen ? (
        <>
          <div class="prompt">Write what you hear</div>
          <div class="prompt-listen">
            <ListenBtn text={ex.show.ru} onReplay={onReplay} />
          </div>
        </>
      ) : ex.gap ? (
        <>
          <div class="prompt">Type the missing word</div>
          <div class="gap">
            <div class="gap-text" lang="ru">
              {renderGap(ex.gap, text.trim() || null)}
            </div>
            <div class="gap-hint">{ex.en}</div>
          </div>
        </>
      ) : (
        <>
          <div class="prompt">Write this in Russian</div>
          <div class="bank-en">{ex.en}</div>
        </>
      )}
      {phone ? (
        <textarea
          class="type-input"
          lang="ru"
          rows={2}
          value={text}
          autoFocus
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          placeholder="Type in Russian"
          onInput={(e) => set((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onEnter())}
        />
      ) : (
        <div class={`type-box${checked ? ' checked' : ''}`} lang="ru" aria-label="Your answer" aria-live="polite">
          {text || <span class="placeholder">Type in Russian</span>}
          {!checked ? <span class="caret" /> : null}
        </div>
      )}
      <button
        type="button"
        class="link-btn small"
        onClick={() => {
          void model.updateSettings({ keyboard: phone ? 'vire' : 'phone' });
          refresh();
        }}
      >
        {phone ? 'Use the Vire keyboard' : 'Use my phone keyboard'}
      </button>
      {!phone && !checked ? <Keyboard onKey={onKey} onBack={onBack} onEnter={onEnter} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ dialogue

function DialogueView({ unit, onNext }: { unit: number; onNext: () => void }) {
  const { model } = useApi();
  const d = model.course.unit(unit).dialogue!;
  const [shown, setShown] = useState(1);
  const [gloss, setGloss] = useState<{ w: string; text: string; x: number; y: number } | null>(null);
  const [en, setEn] = useState<Set<number>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const line = d.lines[shown - 1];
    if (line && model.settings.sound && model.audio) speak(line.ru, { slow: model.settings.slow });
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [shown]);
  const onWord = (w: string, el: HTMLElement) => {
    const hit = model.course.lookup(w);
    const r = el.getBoundingClientRect();
    setGloss({ w, text: hit ? `${hit.stress} · ${hit.en}` : 'not in your word list yet', x: r.left + r.width / 2, y: r.bottom });
    if (model.settings.sound && model.audio) speak(w);
  };
  const all = shown >= d.lines.length;
  return (
    <div class="ex dialogue" onClick={(e) => !(e.target as HTMLElement).closest('.word-tap') && setGloss(null)}>
      <div class="kicker">Dialogue</div>
      <h2>{d.title}</h2>
      <div class="dlg-lines">
        {d.lines.slice(0, shown).map((l, i) => (
          <div class={`dlg-line ${l.speaker === 'Аня' ? 'a' : 'b'}`}>
            <div class="dlg-speaker">{l.speaker === 'Аня' ? 'Аня (Anya)' : l.speaker === 'Марк' ? 'Марк (Mark)' : l.speaker}</div>
            <div class="dlg-bubble">
              <Ru item={l} onWord={onWord} />
              <div class="dlg-tools">
                <SpeakBtn text={l.ru} />
                <button
                  type="button"
                  class="link-btn small"
                  onClick={() => {
                    const s = new Set(en);
                    s.has(i) ? s.delete(i) : s.add(i);
                    setEn(s);
                  }}
                >
                  {en.has(i) ? 'Hide English' : 'English'}
                </button>
              </div>
              {en.has(i) ? <div class="dlg-en">{l.en}</div> : null}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div class="dlg-tip">Tap any word to see what it means.</div>
      {gloss ? (
        <div class="gloss" style={{ left: `${Math.min(Math.max(gloss.x, 110), window.innerWidth - 110)}px`, top: `${gloss.y + 6}px` }} role="tooltip">
          <b lang="ru">{gloss.w}</b> {gloss.text}
        </div>
      ) : null}
      <div class="dlg-foot">
        {all ? (
          <button
            type="button"
            class="btn primary wide"
            onClick={onNext}
          >
            Continue to questions
          </button>
        ) : (
          <button type="button" class="btn primary wide" onClick={() => setShown(shown + 1)}>
            Next line
          </button>
        )}
      </div>
    </div>
  );
}
