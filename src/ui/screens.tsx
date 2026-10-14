import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Outcome, PathStep } from '../model';
import { hasVoice } from '../audio';
import { retrievability } from '../srs';
import { todayKey } from '../text';
import type { AnswerRec, Backup, DayRec, FeedbackRec, SessionRec } from '../store';
import { validateBackup } from '../store';
import { Ru, SpeakBtn, Stars, useApi } from './common';
import { pickFile, saveFile, stamp } from './files';

const A1_TARGET = 780;
const UNIT_COLORS = ['#58a700', '#1cb0f6', '#ce82ff', '#ff9600', '#ff4b4b', '#2b70c9', '#00a99d', '#e5a000', '#a560e8', '#d33131', '#58a700'];

export function unitColor(n: number): string {
  return UNIT_COLORS[n % UNIT_COLORS.length];
}

function shade(hex: string, f: number, alpha = 1): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return alpha < 1 ? `rgba(${c.join(',')},${alpha})` : `rgb(${c.join(',')})`;
}

// ------------------------------------------------------------------ onboarding

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { model } = useApi();
  const [stage, setStage] = useState<'welcome' | 'name'>('welcome');
  const [name, setName] = useState('');
  if (stage === 'welcome') {
    return (
      <div class="onboard">
        <div class="logo-big" aria-hidden="true">В</div>
        <h1>Vire</h1>
        <p class="lead">Russian from zero, at your own pace. No ads, no hearts, no limits. Everything is saved on this phone.</p>
        <button type="button" class="btn primary wide" onClick={() => setStage('name')}>
          Start
        </button>
        <RestoreLink />
      </div>
    );
  }
  return (
    <form
      class="onboard"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await model.createProfile(name);
        onDone();
      }}
    >
      <h1>What's your name?</h1>
      <input class="text-input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="e.g. raud" autoFocus maxLength={40} aria-label="Your name" />
      <p class="muted">You start with the alphabet. Already know some Russian? Tap a later unit on the path to jump ahead with a short test.</p>
      <button type="submit" class="btn primary wide" disabled={!name.trim()}>
        Continue
      </button>
    </form>
  );
}

function RestoreLink() {
  const { store, reload, toast } = useApi();
  return (
    <button
      type="button"
      class="link-btn"
      onClick={async () => {
        const text = await pickFile();
        if (!text) return;
        try {
          const b = JSON.parse(text);
          validateBackup(b);
          await store.importAll(b);
          await reload();
          toast('Backup loaded');
        } catch (e) {
          toast((e as Error).message || 'Could not read that file');
        }
      }}
    >
      I have a backup file
    </button>
  );
}

// ------------------------------------------------------------------ home + path

export function Home({ onStart, onReview, onNotes, onJump }: { onStart: (key: string) => void; onReview: () => void; onNotes: (unit: number) => void; onJump: (unit: number) => void }) {
  const { model } = useApi();
  const st = model.stats();
  const steps = model.pathState();
  const cur = model.currentStep();
  const resume = model.run;
  const [sheet, setSheet] = useState<PathStep | null>(null);
  const curRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keep the greeting in view unless the current step is further down the path.
    const el = curRef.current;
    if (el && el.getBoundingClientRect().bottom > window.innerHeight - 120) el.scrollIntoView({ block: 'center' });
  }, []);

  const units = model.course.units;
  return (
    <div class="home">
      <section class="hero">
        <div class="hello">
          Привет, <b>{model.profile?.name}</b>!
        </div>
        <div class="muted">
          A1 · {st.learned} / {A1_TARGET} words · {st.unitsDone} / {st.unitsTotal} units
        </div>
        {resume ? (
          <button type="button" class="btn primary wide big-btn" onClick={() => onStart(resume.plan.key)}>
            Continue lesson
            <small>{resume.plan.title}</small>
          </button>
        ) : cur ? (
          <button type="button" class="btn primary wide big-btn" onClick={() => onStart(cur.key)}>
            Continue
            <small>{cur.unit === 0 ? `Alphabet · ${cur.title}` : `Unit ${cur.unit} · ${cur.title}`}</small>
          </button>
        ) : (
          <div class="done-all">You finished every unit in this version. Keep reviewing!</div>
        )}
        <button type="button" class="btn secondary wide" onClick={onReview} disabled={!model.canReview()}>
          Review {st.due > 0 ? <span class="badge">{st.due}</span> : null}
        </button>
      </section>

      <InstallHint />

      <section class="path" aria-label="Course path">
        {units.map((u) => {
          const us = steps.filter((s) => s.unit === u.number);
          const color = unitColor(u.number);
          return (
            <div class="unit" key={u.number} style={{ '--unit': color, '--unit-dark': shade(color, 0.72), '--unit-soft': shade(color, 1, 0.28) }}>
              <div class="unit-banner">
                <div>
                  <div class="unit-kicker">{u.kind === 'checkpoint' ? 'Checkpoint' : u.number === 0 ? 'Unit 0' : `Unit ${u.number}`}</div>
                  <div class="unit-title">{u.title}</div>
                </div>
                {u.kind !== 'checkpoint' ? (
                  <button type="button" class="notes-btn" onClick={() => onNotes(u.number)}>
                    Notes
                  </button>
                ) : null}
              </div>
              <div class="nodes">
                {us.map((s, i) => {
                  const offset = Math.round(Math.sin((i / Math.max(1, us.length - 1)) * Math.PI * 1.5) * 70);
                  return (
                    <div class="node-wrap" style={{ transform: `translateX(${offset}px)` }} ref={s.status === 'current' ? curRef : undefined}>
                      {s.status === 'current' ? <div class="start-bubble">{resume?.plan.key === s.key ? 'GO ON' : 'START'}</div> : null}
                      <button
                        type="button"
                        class={`node ${s.status}`}
                        aria-label={`${s.title}, ${s.status}${s.stars ? `, ${s.stars} stars` : ''}`}
                        onClick={() => setSheet(s)}
                        data-step={s.key}
                      >
                        <span class="node-icon">{s.status === 'locked' ? '🔒' : s.icon}</span>
                      </button>
                      {s.status === 'done' ? <Stars n={s.stars} /> : s.status === 'skipped' ? <span class="skipped">skipped</span> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div class="path-end muted">Units 11–21 come after the two-week trial.</div>
      </section>

      {sheet ? (
        <StepSheet
          step={sheet}
          onClose={() => setSheet(null)}
          onStart={() => {
            setSheet(null);
            onStart(sheet.key);
          }}
          onJump={(unit) => {
            setSheet(null);
            onJump(unit);
          }}
        />
      ) : null}
    </div>
  );
}

type InstallEvent = Event & { prompt: () => Promise<void> };
let deferredInstall: InstallEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e as InstallEvent;
});

/** Until Vire is on the home screen: how to put it there (it then opens full screen and keeps its data). */
function InstallHint() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('vire-install-hint') === 'hidden';
    } catch {
      return false;
    }
  });
  if (standalone || hidden) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem('vire-install-hint', 'hidden');
    } catch {
      /* private mode */
    }
  };
  return (
    <div class="install">
      <div>
        <b>Put Vire on your home screen</b>
        <div class="small">
          {ios
            ? 'In Safari tap Share (the square with an arrow), then “Add to Home Screen”. It then opens like an app, works offline and keeps your progress safe.'
            : deferredInstall
              ? 'Install it: it then opens like an app, works offline and keeps your progress safe.'
              : 'In the browser menu (⋮) tap “Add to Home screen” or “Install app”. It then opens like an app and works offline.'}
        </div>
      </div>
      <div class="row">
        {!ios && deferredInstall ? (
          <button
            type="button"
            class="btn primary"
            onClick={async () => {
              await deferredInstall?.prompt();
              deferredInstall = null;
              hide();
            }}
          >
            Install
          </button>
        ) : null}
        <button type="button" class="link-btn small" onClick={hide}>
          Hide
        </button>
      </div>
    </div>
  );
}

function StepSheet({ step, onClose, onStart, onJump }: { step: PathStep; onClose: () => void; onStart: () => void; onJump: (unit: number) => void }) {
  const { model } = useApi();
  const u = model.course.unit(step.unit);
  const cur = model.currentStep();
  const locked = step.status === 'locked';
  const canJump = locked && cur && step.unit > cur.unit;
  const resume = model.run?.plan.key === step.key;
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet" role="dialog" aria-label={step.title} onClick={(e) => e.stopPropagation()}>
        <div class="sheet-kicker">{u.kind === 'checkpoint' ? 'Checkpoint' : `Unit ${u.number} · ${u.title}`}</div>
        <h2>
          {step.icon} {step.title}
        </h2>
        {step.status === 'done' ? (
          <p>
            <Stars n={step.stars} /> Replay as often as you like; it can raise your stars.
          </p>
        ) : null}
        {step.status === 'skipped' ? <p class="muted">Skipped with a test. You can still do it any time.</p> : null}
        {locked ? (
          canJump ? (
            <>
              <p>Not open yet. Already know this? Take a short test on everything before it, and jump here if you get 80%.</p>
              <button type="button" class="btn primary wide" onClick={() => onJump(step.unit)}>
                Jump here (test)
              </button>
            </>
          ) : (
            <>
              <p>Finish the earlier steps of this unit first, or test out of the whole unit.</p>
              {model.course.units.some((x) => x.number === step.unit + 1) ? (
                <button type="button" class="btn secondary wide" onClick={() => onJump(step.unit + 1)}>
                  Test out of this unit
                </button>
              ) : null}
            </>
          )
        ) : (
          <button type="button" class="btn primary wide" onClick={onStart}>
            {resume ? 'Continue' : step.status === 'current' ? 'Start' : 'Practise again'}
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ result

export function Result({ o, onNext, onAgain, onHome }: { o: Outcome; onNext?: () => void; onAgain: () => void; onHome: () => void }) {
  const isTest = o.kind === 'test';
  return (
    <div class="result">
      {o.passed ? (
        <>
          <div class="result-emoji" aria-hidden="true">{o.stars === 3 ? '🏆' : o.stars === 2 ? '🎉' : '👍'}</div>
          <h1>{o.key.startsWith('jump:') ? 'Jump done!' : isTest ? 'Test passed!' : o.kind === 'review' ? 'Review done!' : 'Lesson done!'}</h1>
          {o.kind !== 'review' ? (
            <div class="result-stars">
              <Stars n={o.stars} />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div class="result-emoji" aria-hidden="true">💪</div>
          <h1>Not yet</h1>
          <p>
            You need {o.passPercent}% to pass. Try again whenever you like; nothing is lost.
          </p>
        </>
      )}
      <div class="result-tiles">
        <div class="tile-stat">
          <b>{o.percent}%</b>
          <span>correct first time</span>
        </div>
        <div class="tile-stat">
          <b>{o.correct}/{o.total}</b>
          <span>answers</span>
        </div>
        {o.newWords ? (
          <div class="tile-stat">
            <b>{o.newWords}</b>
            <span>new words</span>
          </div>
        ) : null}
        <div class="tile-stat">
          <b>{o.minutes}</b>
          <span>min</span>
        </div>
      </div>
      <div class="result-actions">
        {o.passed && onNext ? (
          <button type="button" class="btn primary wide" onClick={onNext} autoFocus>
            Continue
          </button>
        ) : null}
        <button type="button" class={`btn ${o.passed && onNext ? 'secondary' : 'primary'} wide`} onClick={onAgain}>
          {o.passed ? 'Practise again' : 'Try again'}
        </button>
        <button type="button" class="link-btn" onClick={onHome}>
          Back to the path
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ unit notes

export function Notes({ unit, onBack }: { unit: number; onBack: () => void }) {
  const { model } = useApi();
  const u = model.course.unit(unit);
  return (
    <div class="page notes">
      <PageHead title={u.number === 0 ? 'The alphabet' : `Unit ${u.number} · ${u.title}`} onBack={onBack} />
      <p class="muted">{u.goal}</p>
      {u.letters ? (
        <>
          <h2>Letters</h2>
          <div class="letter-grid">
            {u.letters.map((l) => (
              <div class="letter-cell">
                <div class="letter-big" lang="ru">{l.letter}</div>
                <div>
                  <b>{l.translit}</b> · {l.sound}
                </div>
                <div class="row">
                  <Ru item={l.example} /> <SpeakBtn text={l.example.ru} />
                </div>
                <div class="muted">{l.example.en}</div>
              </div>
            ))}
          </div>
          <h2>Pronunciation rules</h2>
          {(u.pronunciation_rules ?? []).map((r) => (
            <div class="note-item">
              <h3>{r.title}</h3>
              <p>{r.explanation}</p>
            </div>
          ))}
        </>
      ) : null}
      {u.grammar?.length ? (
        <>
          <h2>Grammar</h2>
          {u.grammar.map((g) => (
            <div class="note-item">
              <h3>{g.title}</h3>
              <p>{g.explanation}</p>
            </div>
          ))}
        </>
      ) : null}
      {u.words?.length ? (
        <>
          <h2>Words</h2>
          <ul class="word-list">
            {u.words.map((w) => (
              <li>
                <div class="row">
                  <Ru item={w} />
                  <SpeakBtn text={w.ru} />
                </div>
                <div class="muted">
                  {w.en}
                  {w.note ? ` · ${w.note}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {u.dialogue ? (
        <>
          <h2>Dialogue: {u.dialogue.title}</h2>
          {u.dialogue.lines.map((l) => (
            <div class="note-line">
              <b>{l.speaker}:</b> <Ru item={l} /> <SpeakBtn text={l.ru} />
              <div class="muted">{l.en}</div>
            </div>
          ))}
        </>
      ) : null}
      {u.sentences?.length ? (
        <>
          <h2>Sentences</h2>
          <ul class="word-list">
            {u.sentences.map((s) => (
              <li>
                <div class="row">
                  <Ru item={s} />
                  <SpeakBtn text={s.ru} />
                </div>
                <div class="muted">{s.en}</div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function PageHead({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header class="page-head">
      {onBack ? (
        <button type="button" class="icon-btn back" aria-label="Back" onClick={onBack}>
          ←
        </button>
      ) : null}
      <h1>{title}</h1>
    </header>
  );
}

// ------------------------------------------------------------------ progress

export function Progress({ onPractise }: { onPractise: (ids: string[]) => void }) {
  const { model } = useApi();
  const st = model.stats();
  const now = Date.now();
  const words = [...model.cards.values()].filter((c) => model.course.item(c.id)?.kind === 'word');
  const learnedLine = useMemo(() => {
    const dates = words.filter((c) => c.learnedAt).map((c) => todayKey(new Date(c.learnedAt!)));
    if (!dates.length) return [];
    const first = new Date(Math.min(...words.filter((c) => c.learnedAt).map((c) => c.learnedAt!)));
    first.setHours(12, 0, 0, 0);
    const out: { day: string; n: number }[] = [];
    let total = 0;
    for (let d = new Date(first); todayKey(d) <= todayKey(); d.setDate(d.getDate() + 1)) {
      const k = todayKey(d);
      total += dates.filter((x) => x === k).length;
      out.push({ day: k, n: total });
      if (out.length > 400) break;
    }
    return out;
  }, [model.cards.size, st.learned]);
  const last30 = useMemo(() => {
    const out: DayRec[] = [];
    const d = new Date();
    d.setHours(12);
    d.setDate(d.getDate() - 29);
    for (let i = 0; i < 30; i++) {
      const k = todayKey(d);
      out.push(model.days.get(k) ?? { date: k, exercises: 0, seconds: 0, newWords: 0, correct: 0 });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [model.days.size]);
  const hardest = [...model.cards.values()]
    .filter((c) => c.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || retrievability(a, now) - retrievability(b, now))
    .slice(0, 10);
  const week = last30.slice(-7);
  const weekEx = week.reduce((a, d) => a + d.exercises, 0);
  const weekOk = week.reduce((a, d) => a + d.correct, 0);
  return (
    <div class="page">
      <PageHead title="Progress" />
      <div class="stat-grid">
        <Stat n={st.learned} label="words learned" />
        <Stat n={st.strong} label="words strong (3+ weeks)" />
        <Stat n={`${st.unitsDone}/${st.unitsTotal}`} label="units done" />
        <Stat n={st.due} label="cards due" />
        <Stat n={st.daysUsed} label="days used" />
        <Stat n={weekEx ? `${Math.round((weekOk / weekEx) * 100)}%` : '–'} label="correct, last 7 days" />
      </div>
      <h2>Words learned</h2>
      <LineChart points={learnedLine.map((p) => p.n)} labels={learnedLine.map((p) => p.day)} goal={A1_TARGET} />
      <h2>Exercises per day (30 days)</h2>
      <Bars values={last30.map((d) => d.exercises)} labels={last30.map((d) => d.date)} />
      <h2>Hardest items</h2>
      {hardest.length ? (
        <>
          <ul class="word-list">
            {hardest.map((c) => {
              const item = model.course.item(c.id);
              const w = item?.word ?? item?.sentence;
              return (
                <li>
                  <div class="row">
                    {w ? <Ru item={w} /> : item?.drill ? <span lang="ru">{item.drill.prompt.replace('___', item.drill.answer)}</span> : item?.letter?.letter}
                    <span class="muted"> · wrong {c.wrong}×</span>
                  </div>
                  {w ? <div class="muted">{w.en}</div> : null}
                </li>
              );
            })}
          </ul>
          <button type="button" class="btn secondary wide" onClick={() => onPractise(hardest.map((c) => c.id))}>
            Practise these
          </button>
        </>
      ) : (
        <p class="muted">Nothing yet. Words you miss will show up here.</p>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <div class="tile-stat">
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

function LineChart({ points, labels, goal }: { points: number[]; labels: string[]; goal: number }) {
  if (points.length === 0) return <p class="muted">Your line starts with your first correct answer.</p>;
  const W = 320;
  const H = 160;
  const pad = 28;
  const max = Math.max(10, ...points) * 1.15;
  const xs = (i: number) => pad + (points.length === 1 ? (W - pad - 8) / 2 : (i / (points.length - 1)) * (W - pad - 8));
  const ys = (v: number) => H - 20 - (v / max) * (H - 30);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <figure class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Words learned: ${last} of ${goal}`}>
        {[0, 0.5, 1].map((f) => (
          <g>
            <line x1={pad} x2={W - 4} y1={ys(max * f / 1.15)} y2={ys(max * f / 1.15)} class="grid" />
            <text x={pad - 4} y={ys(max * f / 1.15) + 4} class="axis" text-anchor="end">
              {Math.round(max * f / 1.15)}
            </text>
          </g>
        ))}
        <path d={`${d} L${xs(points.length - 1)},${H - 20} L${xs(0)},${H - 20} Z`} class="area" />
        <path d={d} class="line" />
        {points.length < 40 ? points.map((v, i) => <circle cx={xs(i)} cy={ys(v)} r={3} class="dot" />) : null}
        <text x={pad} y={H - 4} class="axis">{labels[0]?.slice(5)}</text>
        <text x={W - 4} y={H - 4} class="axis" text-anchor="end">{labels[labels.length - 1]?.slice(5)}</text>
      </svg>
      <figcaption class="muted">
        {last} of {goal} A1 words ({Math.round((last / goal) * 100)}%)
      </figcaption>
    </figure>
  );
}

function Bars({ values, labels }: { values: number[]; labels: string[] }) {
  const W = 320;
  const H = 110;
  const max = Math.max(5, ...values);
  const bw = (W - 8) / values.length;
  return (
    <figure class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Exercises per day for the last 30 days">
        {values.map((v, i) => {
          const h = (v / max) * (H - 24);
          return (
            <rect x={4 + i * bw + 1} y={H - 18 - h} width={bw - 2} height={Math.max(v ? 2 : 0, h)} rx={2} class={v ? 'bar' : 'bar zero'}>
              <title>
                {labels[i]}: {v}
              </title>
            </rect>
          );
        })}
        <line x1={4} x2={W - 4} y1={H - 18} y2={H - 18} class="grid" />
        <text x={4} y={H - 4} class="axis">{labels[0]?.slice(5)}</text>
        <text x={W - 4} y={H - 4} class="axis" text-anchor="end">today</text>
      </svg>
    </figure>
  );
}

// ------------------------------------------------------------------ words

export function Words() {
  const { model } = useApi();
  const [q, setQ] = useState('');
  const now = Date.now();
  const list = [...model.cards.values()]
    .map((c) => ({ c, item: model.course.item(c.id) }))
    .filter((x) => x.item?.kind === 'word')
    .filter((x) => {
      if (!q.trim()) return true;
      const w = x.item!.word!;
      const s = q.trim().toLowerCase();
      return w.ru.toLowerCase().includes(s) || w.en.toLowerCase().includes(s) || w.translit.toLowerCase().includes(s);
    })
    .sort((a, b) => a.c.unit - b.c.unit || a.c.id.localeCompare(b.c.id));
  return (
    <div class="page">
      <PageHead title="Words" />
      <input class="text-input" type="search" placeholder="Search Russian or English" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search words" />
      <p class="muted">{list.length} words you have met. The bar shows how likely you are to remember each one now.</p>
      <ul class="word-list">
        {list.map(({ c, item }) => {
          const w = item!.word!;
          const r = Math.round(retrievability(c, now) * 100);
          return (
            <li>
              <div class="row">
                <Ru item={w} />
                <SpeakBtn text={w.ru} />
              </div>
              <div class="muted">
                {w.en} · Unit {c.unit}
              </div>
              <div class="strength" aria-label={`${r}% remembered`}>
                <div style={{ width: `${r}%` }} class={r >= 85 ? 'hi' : r >= 60 ? 'mid' : 'lo'} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ settings

export function SettingsPage() {
  const { model, store, refresh, reload, toast } = useApi();
  const s = model.settings;
  const [name, setName] = useState(model.profile?.name ?? '');
  const [counts, setCounts] = useState<{ answers: number; feedback: number } | null>(null);
  useEffect(() => {
    Promise.all([store.count('answers'), store.count('feedback')]).then(([answers, feedback]) => setCounts({ answers, feedback }));
  }, []);
  const toggle = async (k: keyof typeof s, v: boolean | string) => {
    await model.updateSettings({ [k]: v });
    refresh();
  };
  return (
    <div class="page settings">
      <PageHead title="Settings" />
      <h2>You</h2>
      <div class="row">
        <input class="text-input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="Your name" maxLength={40} />
        <button
          type="button"
          class="btn secondary"
          disabled={!name.trim() || name === model.profile?.name}
          onClick={async () => {
            await model.rename(name);
            refresh();
            toast('Saved');
          }}
        >
          Save
        </button>
      </div>
      <h2>Showing Russian</h2>
      <Toggle label="Stress marks (´)" on={s.stress} onChange={(v) => toggle('stress', v)} />
      <Toggle label="Transliteration (Latin letters)" on={s.translit} onChange={(v) => toggle('translit', v)} />
      <Toggle label="Sound" on={s.sound} onChange={(v) => toggle('sound', v)} />
      <Toggle label="Slow speech" on={s.slow} onChange={(v) => toggle('slow', v)} />
      <Toggle label="Use my phone's keyboard for typing" on={s.keyboard === 'phone'} onChange={(v) => toggle('keyboard', v ? 'phone' : 'vire')} />
      {!hasVoice() ? (
        <p class="warn">
          This phone has no Russian voice, so listening exercises are skipped. To add one: iPhone: Settings → Accessibility → Spoken Content → Voices → Russian. Android: Settings → Text-to-speech → Google → Install voice data → Russian. Then reopen Vire.
        </p>
      ) : null}

      <h2>Backup</h2>
      <p class="muted">Your progress lives only on this phone. Save a backup now and then (e.g. to Files or Google Drive) so you can move to a new phone.</p>
      <button
        type="button"
        class="btn secondary wide"
        onClick={async () => {
          await model.flush();
          const b = await store.exportAll();
          const r = await saveFile(`vire-backup-${stamp()}.json`, JSON.stringify(b));
          if (r !== 'cancelled') toast('Backup saved');
        }}
      >
        Save backup
      </button>
      <button
        type="button"
        class="btn secondary wide"
        onClick={async () => {
          const text = await pickFile();
          if (!text) return;
          let b: Backup;
          try {
            b = JSON.parse(text);
            validateBackup(b);
          } catch (e) {
            toast((e as Error).message || 'Could not read that file');
            return;
          }
          const when = new Date(b.saved).toLocaleString();
          if (!confirm(`Replace everything on this phone with the backup from ${when}?`)) return;
          await store.importAll(b);
          await reload();
          toast('Backup loaded');
        }}
      >
        Load backup
      </button>

      <h2>Two-week trial</h2>
      <p class="muted">
        {counts ? `${counts.answers} answers and ${counts.feedback} feedback notes recorded. ` : ''}
        Export the trial log and give the file to Claude: it holds your answers, feedback notes and daily minutes.
      </p>
      <button
        type="button"
        class="btn secondary wide"
        onClick={async () => {
          await model.flush();
          const [answers, feedback, sessions] = await Promise.all([store.all<AnswerRec>('answers'), store.all<FeedbackRec>('feedback'), store.all<SessionRec>('sessions')]);
          const log = {
            app: 'vire-trial-log',
            exported: new Date().toISOString(),
            name: model.profile?.name,
            started: model.profile ? new Date(model.profile.created).toISOString() : undefined,
            stats: model.stats(),
            steps: [...model.steps.values()],
            days: [...model.days.values()],
            sessions: sessions.map((x) => ({ opened: new Date(x.opened).toISOString(), msToFirstExercise: x.firstExercise ? x.firstExercise - x.opened : null })),
            feedback: feedback.map((f) => ({ ...f, t: new Date(f.t).toISOString() })),
            answers: answers.map((a) => ({ ...a, t: new Date(a.t).toISOString() })),
          };
          const r = await saveFile(`vire-trial-log-${stamp()}.json`, JSON.stringify(log, null, 1));
          if (r !== 'cancelled') toast('Trial log saved');
        }}
      >
        Export trial log
      </button>

      <h2>About</h2>
      <p class="muted small">
        Vire is a personal, free Russian course. Review timing: FSRS (ts-fsrs, MIT). Word forms for the typo check: OpenRussian dictionary data (CC BY-SA 4.0). Pronunciation: your phone's own Russian voice. The Russian has been checked against dictionaries but not yet by a native speaker.
      </p>
      <p class="muted small">Version {__VERSION__}</p>
      <button
        type="button"
        class="link-btn danger-text"
        onClick={async () => {
          if (!confirm('Delete ALL progress on this phone? Save a backup first if you might want it back.')) return;
          if (!confirm('Really delete everything?')) return;
          await store.wipe();
          await reload();
        }}
      >
        Delete all progress
      </button>
    </div>
  );
}

declare const __VERSION__: string;

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span class="switch" aria-hidden="true" />
    </label>
  );
}

// ------------------------------------------------------------------ feedback (trial tool)

const TAGS = ['wrong Russian', 'confusing', 'too easy', 'too hard', 'boring', 'bug', 'idea'];

export function FeedbackModal({ screen, item, onClose }: { screen: string; item?: string; onClose: () => void }) {
  const { store, toast } = useApi();
  const [tag, setTag] = useState<string | undefined>();
  const [text, setText] = useState('');
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <form
        class="sheet"
        role="dialog"
        aria-label="Feedback"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          await store.addFeedback({ t: Date.now(), screen, item, tag, text: text.trim() });
          toast('Thanks! Saved for the trial log.');
          onClose();
        }}
      >
        <h2>Feedback</h2>
        <p class="muted small">
          Saved on this phone with the screen{item ? ' and this exercise' : ''}, for the trial log.
        </p>
        <div class="tags">
          {TAGS.map((t) => (
            <button type="button" class={`chip${tag === t ? ' on' : ''}`} onClick={() => setTag(tag === t ? undefined : t)}>
              {t}
            </button>
          ))}
        </div>
        <textarea class="text-input" rows={3} placeholder="What happened? (optional)" value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        <div class="row end">
          <button type="button" class="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary" disabled={!tag && !text.trim()}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
