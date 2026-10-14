import { describe, expect, it } from 'vitest';
import { Model, type AnswerInput, type Persist } from '../src/model';
import type { Exercise } from '../src/lessons';
import { seeded } from '../src/text';
import { loadCourse } from './helpers';

const course = loadCourse();

class MemPersist implements Persist {
  writes = 0;
  answers = 0;
  async commit(w: Parameters<Persist['commit']>[0]) {
    this.writes++;
    if (w.answer) this.answers++;
  }
}

function fresh(seed = 1) {
  const p = new MemPersist();
  const m = new Model(course, { steps: new Map(), cards: new Map(), days: new Map() }, p);
  m.rnd = seeded(seed);
  m.audio = true;
  return { m, p };
}

function right(e: Exercise): AnswerInput {
  return { verdict: 'correct', secs: 3, wrongCards: [] };
}

/** Play the current lesson to the end, answering everything right (or wrong when `wrong` says so). */
function play(m: Model, wrong: (e: Exercise, i: number) => boolean = () => false) {
  let i = 0;
  for (let guard = 0; guard < 500; guard++) {
    const e = m.currentExercise()!;
    if (e.t === 'intro') m.seeIntro(e);
    else if (e.t === 'choice' || e.t === 'bank' || e.t === 'type' || e.t === 'match') {
      const w = wrong(e, i++);
      m.answer(w ? { verdict: 'wrong', secs: 2, wrongCards: e.t === 'match' ? [e.pairs[0].cardId!] : [] } : right(e));
    }
    const out = m.next();
    if (out) return out;
  }
  throw new Error('lesson did not end');
}

describe('the whole path', () => {
  it('can be finished step by step, units 1–20 and both checkpoints', async () => {
    const { m, p } = fresh();
    await m.createProfile('raud');
    let day = Date.UTC(2026, 9, 15, 8);
    m.now = () => day;
    while (m.currentStep()) {
      const s = m.currentStep()!;
      m.startStep(s.key);
      const out = play(m);
      expect(out.passed, s.key).toBe(true);
      expect(out.stars, s.key).toBe(3);
      day += 3600_000 * 5;
    }
    expect(m.pathState().every((s) => s.status === 'done')).toBe(true);
    const st = m.stats();
    expect(st.unitsDone).toBe(21);
    expect(st.learned).toBe([...course.items.values()].filter((i) => i.kind === 'word').length);
    expect(m.level()).toBe(2); // everything right → auto moved up to hard
    await m.flush();
    expect(p.answers).toBeGreaterThan(500);
  });
});

describe('inside a lesson', () => {
  it('brings a wrong answer back at the end until it is right, and stars use first tries', () => {
    const { m } = fresh(2);
    m.startStep('u1s1');
    const graded = m.run!.queue.filter((e) => e.t !== 'intro').length;
    const out = play(m, (_e, i) => i === 0);
    expect(out.correct).toBe(graded - 1);
    expect(out.stars).toBe(2); // one mistake of ~15 → 93%
  });
  it('a failed unit test does not complete the step', () => {
    const { m } = fresh(3);
    m.startStep('u1s7');
    const out = play(m, (_e, i) => i < 4);
    expect(out.passed).toBe(false);
    expect(m.steps.has('u1s7')).toBe(false);
  });
  it('replaying a done step never moves the current step back and keeps the best stars', () => {
    const { m } = fresh(4);
    m.startStep('u1s1');
    play(m);
    const cur = m.currentStep()!.key;
    m.startStep('u1s1');
    play(m, (_e, i) => i < 3);
    expect(m.currentStep()!.key).toBe(cur);
    expect(m.steps.get('u1s1')!.stars).toBe(3);
    expect(m.steps.get('u1s1')!.plays).toBe(2);
  });
  it('rates a card only once per lesson', () => {
    const { m } = fresh(5);
    m.startStep('u1s1');
    play(m, (e) => e.t === 'choice' && e.cardId === 'a1-u01-w01' && !e.key.endsWith('~r'));
    const c = m.cards.get('a1-u01-w01')!;
    expect(c.reps).toBe(1);
    expect(c.lapses).toBe(0);
  });
  it('"my answer was correct" takes back the mistake', () => {
    const { m } = fresh(6);
    m.startStep('u1s5');
    while (m.currentExercise()!.t !== 'type') {
      m.answer({ verdict: 'correct', secs: 3 });
      m.next();
    }
    const len = m.run!.queue.length;
    m.answer({ verdict: 'wrong', secs: 3, given: 'привет' });
    expect(m.run!.queue.length).toBe(len + 1);
    m.overrideLast();
    expect(m.run!.queue.length).toBe(len);
    const key = m.currentExercise()!.key;
    expect(m.run!.first[key]).toBe(true);
  });
});

describe('jump here', () => {
  it('passing the jump test marks the units in between as skipped', () => {
    const { m } = fresh(7);
    m.startJump(4);
    play(m);
    const state = m.pathState();
    expect(state.filter((s) => s.unit < 4).every((s) => s.status === 'skipped')).toBe(true);
    expect(m.currentStep()!.key).toBe('u4s1');
  });
  it('failing it changes nothing', () => {
    const { m } = fresh(8);
    m.startJump(4);
    play(m, (_e, i) => i % 3 === 0);
    expect(m.steps.size).toBe(0);
  });
});

describe('reviews', () => {
  it('cards become due days later and the review round serves them first', () => {
    const { m } = fresh(9);
    let now = Date.UTC(2026, 9, 15, 8);
    m.now = () => now;
    m.startStep('u1s1');
    play(m);
    expect(m.dueCount()).toBe(0);
    now += 30 * 86400_000;
    expect(m.dueCount()).toBeGreaterThan(5);
    m.startReview();
    const ids = m.run!.queue.map((e) => ('cardId' in e ? e.cardId : undefined));
    expect(ids.every((id) => !!id)).toBe(true);
  });
});

describe('challenge', () => {
  const day = (date: string, exercises: number, correct: number) => [date, { date, exercises, seconds: 0, newWords: 0, correct, dueAtStart: 0 }] as const;
  function withDays(days: ReturnType<typeof day>[], challenge?: 'auto' | 'normal' | 'hard') {
    const m = new Model(course, { steps: new Map(), cards: new Map(), days: new Map(days) }, new MemPersist());
    if (challenge) m.profile = { name: 'r', created: 0, settings: { ...m.settings, challenge } };
    return m;
  }
  it('auto follows recent accuracy, aiming near 85%', () => {
    expect(withDays([]).level()).toBe(1);
    expect(withDays([day('2026-10-14', 60, 58)]).level()).toBe(2);
    expect(withDays([day('2026-10-14', 60, 51)]).level()).toBe(1);
    expect(withDays([day('2026-10-14', 60, 36)]).level()).toBe(0);
    // only the most recent ~60 answers count
    expect(withDays([day('2026-10-14', 60, 59), day('2026-10-01', 200, 100)]).level()).toBe(2);
  });
  it('normal and hard are fixed', () => {
    expect(withDays([day('2026-10-14', 60, 20)], 'hard').level()).toBe(2);
    expect(withDays([day('2026-10-14', 60, 60)], 'normal').level()).toBe(1);
  });
  it('an old profile gets auto challenge and no Latin letters; alphabet cards and lessons are dropped', () => {
    const letter = { id: 'a1-u00-L01', unit: 0 } as never;
    const p = new MemPersist();
    const m = new Model(
      course,
      {
        profile: { name: 'raud', created: 0, settings: { stress: true, translit: true, sound: true, slow: false, keyboard: 'vire' } as never },
        steps: new Map([['u0s1', { key: 'u0s1' } as never]]),
        cards: new Map([['a1-u00-L01', letter]]),
        days: new Map(),
        run: { plan: { key: 'u0s2', kind: 'learn', title: '', exercises: [] }, queue: [], pos: 0 } as never,
      },
      p,
    );
    expect(m.settings.challenge).toBe('auto');
    expect(m.settings.translit).toBe(false);
    expect(m.cards.size).toBe(0);
    expect(m.run).toBeUndefined();
    expect(m.currentStep()!.key).toBe('u1s1');
    expect(p.writes).toBe(1);
  });
  it("“Can't listen now” turns dictation into typing from English", () => {
    const { m } = fresh(12);
    m.profile = { name: 'r', created: 0, settings: { ...m.settings, challenge: 'hard' } };
    m.startStep('u2s5');
    expect(m.run!.queue.some((e) => e.t === 'type' && e.listen)).toBe(true);
    m.noListen();
    expect(m.run!.queue.some((e) => e.t === 'type' && e.listen)).toBe(false);
  });
});
