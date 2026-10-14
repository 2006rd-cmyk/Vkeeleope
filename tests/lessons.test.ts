import { describe, expect, it } from 'vitest';
import { allSteps, buildJumpTest, buildStep, isGraded, type BuildCtx, type Exercise, type Level } from '../src/lessons';
import { normRu, seeded } from '../src/text';
import type { CardRec } from '../src/srs';
import { loadCourse } from './helpers';

const course = loadCourse();

function ctx(seed: number, cards = new Map<string, CardRec>(), audio = true, level: Level = 1): BuildCtx {
  return { course, cards, now: Date.now(), rnd: seeded(seed), audio, level };
}

function multisetContains(tiles: string[], need: string[]): boolean {
  const pool = tiles.map(normRu);
  for (const n of need.map(normRu)) {
    const i = pool.indexOf(n);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

function checkExercise(e: Exercise, where: string) {
  if (e.t === 'choice') {
    expect(e.options.length, where).toBeGreaterThanOrEqual(e.mode === 'question' ? 2 : 3);
    expect(e.answer, where).toBeGreaterThanOrEqual(0);
    expect(e.answer, where).toBeLessThan(e.options.length);
    const texts = e.options.map((o) => (o.ru ? normRu(o.text) : o.text.toLowerCase()));
    expect(new Set(texts).size, `${where} duplicate options ${texts}`).toBe(texts.length);
    if (e.mode === 'meaning') expect(e.options[e.answer].text, where).toBe(e.show.en);
    if (e.mode === 'russian' || e.mode === 'listen') expect(e.options[e.answer].text, where).toBe(e.show.ru);
    if (e.mode === 'gap') expect(e.letter, where).toContain('___');
  }
  if (e.t === 'bank') {
    const ok = e.accepted.some((a) => multisetContains(e.tiles, a.match(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g) ?? []));
    expect(ok, `${where} tiles ${e.tiles} cannot build ${e.accepted[0]}`).toBe(true);
    expect(e.tiles.length, where).toBeGreaterThan(2);
    // Capital letters never give the answer away (04 "Word-bank tiles")
    const caps = e.tiles.filter((t) => /^[А-ЯЁ]/.test(t));
    const answerCaps = (e.accepted[0].match(/[А-Яа-яЁё]+/g) ?? []).filter((t) => course.properNouns.has(t));
    if (answerCaps.length) expect(caps.length, `${where} name tile alone: ${e.tiles}`).toBeGreaterThan(answerCaps.length);
  }
  if (e.t === 'type') {
    expect(e.accepted.length, where).toBeGreaterThan(0);
    if (e.gap) {
      expect(e.gap, where).toContain('___');
      expect(e.gap.replace('___', e.accepted[0]), where).toBe(e.show.ru);
    }
    if (e.listen) expect(e.show.ru, where).toBeTruthy();
  }
  if (e.t === 'match') {
    expect(e.pairs.length, where).toBeGreaterThanOrEqual(3);
    expect(new Set(e.pairs.map((p) => p.right.toLowerCase())).size, where).toBe(e.pairs.length);
    expect(new Set(e.pairs.map((p) => normRu(p.left))).size, where).toBe(e.pairs.length);
  }
}

describe('every path step builds valid lessons', () => {
  const steps = allSteps(course);
  it('has the expected path: units 1–9 and 11–20 = 7 steps, checkpoints 10 and 21 = 1, no alphabet', () => {
    expect(steps.filter((s) => s.unit === 0)).toHaveLength(0);
    expect(steps[0].key).toBe('u1s1');
    for (let u = 1; u <= 20; u++) if (u !== 10) expect(steps.filter((s) => s.unit === u), `unit ${u}`).toHaveLength(7);
    expect(steps.filter((s) => s.unit === 10)).toHaveLength(1);
    expect(steps.filter((s) => s.unit === 21)).toHaveLength(1);
    expect(steps).toHaveLength(19 * 7 + 2);
  });
  for (const step of steps) {
    it(`${step.key} ${step.title}`, () => {
      for (let seed = 1; seed <= 24; seed++) {
        const plan = buildStep(ctx(seed, new Map(), seed % 2 === 0, (seed % 3) as Level), step);
        const graded = plan.exercises.filter(isGraded);
        expect(graded.length, `${step.key} seed ${seed}`).toBeGreaterThanOrEqual(step.kind === 'review' ? 8 : 6);
        if (plan.kind === 'test') expect(graded.length).toBeGreaterThanOrEqual(12);
        plan.exercises.forEach((e) => checkExercise(e, `${step.key}/${seed}/${e.key}`));
        expect(() => JSON.parse(JSON.stringify(plan))).not.toThrow();
        if (seed % 2 === 1) expect(plan.exercises.some((e) => (e.t === 'choice' && e.mode === 'listen') || (e.t === 'type' && e.listen))).toBe(false);
      }
    });
  }
  it('every word of units 1–20 is introduced in New words 1 or 2', () => {
    for (let u = 1; u <= 20; u++) {
      if (u === 10) continue;
      const ids = new Set<string>();
      for (const s of steps.filter((x) => x.unit === u && x.kind === 'words')) {
        for (const e of buildStep(ctx(7), s).exercises) if (e.t === 'intro') ids.add(e.key.split(':')[1].split('#')[0]);
      }
      for (const w of course.unit(u).words ?? []) expect(ids.has(w.id), `${w.id} ${w.ru}`).toBe(true);
    }
  });
  it('harder levels ask for more typing than tapping', () => {
    const typed = (level: Level) => {
      let t = 0;
      let all = 0;
      for (const st of steps.filter((x) => x.kind !== 'review' && x.kind !== 'checkpoint'))
        for (let seed = 1; seed <= 3; seed++)
          for (const e of buildStep(ctx(seed, new Map(), true, level), st).exercises.filter(isGraded)) {
            all++;
            if (e.t === 'type') t++;
          }
      return t / all;
    };
    const [l0, l1, l2] = [typed(0), typed(1), typed(2)];
    expect(l1).toBeGreaterThan(l0 + 0.1);
    expect(l2).toBeGreaterThan(l1);
    expect(l1).toBeGreaterThan(0.3);
  });
  it('word banks offer other endings of the answer words on normal and hard', () => {
    let near = 0;
    let banks = 0;
    for (const st of steps.filter((x) => x.kind === 'sentences' || x.kind === 'grammar'))
      for (const e of buildStep(ctx(5, new Map(), true, 2), st).exercises) {
        if (e.t !== 'bank') continue;
        banks++;
        const ans = new Set((e.accepted[0].match(/[А-Яа-яЁё]+/g) ?? []).map(normRu));
        if (e.tiles.some((t) => !ans.has(normRu(t)) && [...ans].some((a) => a.length >= 3 && normRu(t).startsWith(a.slice(0, Math.max(3, a.length - 2)))))) near++;
      }
    expect(banks).toBeGreaterThan(10);
    expect(near / banks).toBeGreaterThan(0.3);
  });
  it('lessons are a sensible length (graded exercises)', () => {
    for (const s of steps) {
      if (s.kind === 'review' || s.kind === 'checkpoint') continue;
      const n = buildStep(ctx(11), s).exercises.filter(isGraded).length;
      expect(n, s.key).toBeLessThanOrEqual(30);
    }
  });
  it('jump tests cover the units in between', () => {
    for (let to = 2; to <= 21; to++) {
      const p = buildJumpTest(ctx(to), 1, to);
      expect(p.exercises.length).toBeGreaterThanOrEqual(6);
      p.exercises.forEach((e) => checkExercise(e, `jump ${to}`));
    }
  });
});
