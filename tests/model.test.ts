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
  it('can be finished step by step, every unit 0–9 and the checkpoint', async () => {
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
    expect(st.unitsDone).toBe(11);
    expect(st.learned).toBe(185); // every word of units 1–9
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
    m.startStep('u0s1');
    play(m);
    const cur = m.currentStep()!.key;
    m.startStep('u0s1');
    play(m, (_e, i) => i < 3);
    expect(m.currentStep()!.key).toBe(cur);
    expect(m.steps.get('u0s1')!.stars).toBe(3);
    expect(m.steps.get('u0s1')!.plays).toBe(2);
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
