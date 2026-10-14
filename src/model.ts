// App state and rules: the path, lessons in progress, answers, reviews and saving.
import type { Course } from './content';
import {
  again,
  allSteps,
  buildJumpTest,
  buildStep,
  cardsIn,
  choiceMeaning,
  dueCards,
  isGraded,
  reviewRound,
  type BuildCtx,
  type Level,
  type Exercise,
  type Graded,
  type LessonPlan,
  type StepDef,
} from './lessons';
import { countSeen, isStrong, newCard, rate, ratingFor, Rating, type CardRec } from './srs';
import type { AnswerRec, DayRec, Profile, Run, Settings, Snapshot, StepRec } from './store';
import { todayKey } from './text';
import { asRu } from './content';

export interface Persist {
  commit(w: {
    profile?: Profile;
    run?: Run | null;
    cards?: CardRec[];
    steps?: StepRec[];
    day?: DayRec;
    answer?: AnswerRec;
  }): Promise<void>;
}

export type StepStatus = 'done' | 'skipped' | 'current' | 'locked';

export interface PathStep extends StepDef {
  status: StepStatus;
  stars: number;
}

export interface AnswerInput {
  verdict: 'correct' | 'almost' | 'wrong';
  secs: number;
  given?: string;
  replays?: number;
  /** Match pairs: cards that were paired wrongly at least once. */
  wrongCards?: string[];
}

export interface Outcome {
  kind: LessonPlan['kind'];
  key: string;
  title: string;
  correct: number;
  total: number;
  percent: number;
  passed: boolean;
  stars: number;
  newWords: number;
  passPercent?: number;
  minutes: number;
}

export const DEFAULT_SETTINGS: Settings = { stress: true, translit: false, sound: true, slow: false, keyboard: 'vire', challenge: 'auto' };

export class Model {
  profile?: Profile;
  steps: Map<string, StepRec>;
  cards: Map<string, CardRec>;
  days: Map<string, DayRec>;
  run?: Run;
  readonly path: StepDef[];
  audio = false;
  rnd: () => number = Math.random;
  now: () => number = () => Date.now();
  private undo?: { cards: CardRec[]; requeued: boolean; firstKey?: string; answer: AnswerInput; ex: Graded };
  private saving: Promise<void> = Promise.resolve();
  private pendingNew = 0;
  onError: (e: unknown) => void = (e) => console.error(e);

  constructor(readonly course: Course, snap: Snapshot, private persist: Persist) {
    this.profile = snap.profile;
    this.steps = snap.steps;
    this.cards = snap.cards;
    this.days = snap.days;
    this.run = snap.run;
    this.path = allSteps(course);
    // Cards and a lesson in progress from units no longer in the course (the alphabet) are left
    // in storage, so a backup keeps them, but are not used.
    for (const id of [...this.cards.keys()]) if (!course.item(id)) this.cards.delete(id);
    if (this.run && !this.run.plan?.exercises) this.run = undefined;
    if (this.run && /^u\d+s\d+$/.test(this.run.plan.key) && !this.path.some((s) => s.key === this.run!.plan.key)) this.run = undefined;
    // Profiles from before the challenge setting: Latin letters off (raud reads Cyrillic), auto challenge.
    if (this.profile && !this.profile.settings.challenge) {
      this.profile = { ...this.profile, settings: { ...this.profile.settings, translit: false, challenge: 'auto' } };
      void this.save({ profile: this.profile });
    }
  }

  get settings(): Settings {
    return { ...DEFAULT_SETTINGS, ...this.profile?.settings };
  }

  /** Writes are queued so they land in order; each one is a single transaction. */
  private save(w: Parameters<Persist['commit']>[0]): Promise<void> {
    // The transaction is opened right away (IndexedDB runs overlapping write transactions in the
    // order they were created), so a write is never left waiting in memory when the app closes.
    const p = this.persist.commit(w).catch((e) => this.onError(e));
    this.saving = Promise.all([this.saving, p]).then(() => undefined);
    return p;
  }

  flush(): Promise<void> {
    return this.saving;
  }

  ctx(): BuildCtx {
    return { course: this.course, cards: this.cards, now: this.now(), rnd: this.rnd, audio: this.audio && this.settings.sound && !this.run?.noListen, level: this.level() };
  }

  /** Recent first-answer accuracy over the last ~60 answers, or null with too few answers. */
  recentAccuracy(): number | null {
    let n = 0;
    let ok = 0;
    for (const d of [...this.days.values()].sort((a, b) => (a.date < b.date ? 1 : -1))) {
      n += d.exercises;
      ok += d.correct;
      if (n >= 60) break;
    }
    return n >= 30 ? ok / n : null;
  }

  /**
   * Challenge level for new lessons. Auto keeps the error rate near 15%: learning is fastest when
   * about 85% of answers are right (Wilson et al. 2019), so very high accuracy means "make it harder".
   */
  level(): Level {
    const c = this.settings.challenge;
    if (c === 'hard') return 2;
    if (c === 'normal') return 1;
    const a = this.recentAccuracy();
    if (a === null) return 1;
    if (a >= 0.9) return 2;
    if (a < 0.72) return 0;
    return 1;
  }

  // ------------------------------------------------------------ profile

  createProfile(name: string): Promise<void> {
    this.profile = { name: name.trim() || 'friend', created: this.now(), settings: { ...DEFAULT_SETTINGS } };
    return this.save({ profile: this.profile });
  }

  updateSettings(s: Partial<Settings>): Promise<void> {
    if (!this.profile) return Promise.resolve();
    this.profile = { ...this.profile, settings: { ...this.settings, ...s } };
    return this.save({ profile: this.profile });
  }

  rename(name: string): Promise<void> {
    if (!this.profile || !name.trim()) return Promise.resolve();
    this.profile = { ...this.profile, name: name.trim() };
    return this.save({ profile: this.profile });
  }

  // ------------------------------------------------------------ path

  currentIndex(): number {
    const i = this.path.findIndex((s) => !this.steps.has(s.key));
    return i < 0 ? this.path.length : i;
  }

  pathState(): PathStep[] {
    const cur = this.currentIndex();
    return this.path.map((s, i) => {
      const rec = this.steps.get(s.key);
      const status: StepStatus = rec ? rec.status : i === cur ? 'current' : 'locked';
      return { ...s, status, stars: rec?.stars ?? 0 };
    });
  }

  currentStep(): StepDef | undefined {
    return this.path[this.currentIndex()];
  }

  isOpen(key: string): boolean {
    const i = this.path.findIndex((s) => s.key === key);
    return i >= 0 && i <= this.currentIndex();
  }

  // ------------------------------------------------------------ starting lessons

  private begin(plan: LessonPlan): Run {
    this.undo = undefined;
    this.run = { plan, queue: plan.exercises, pos: 0, first: {}, rated: [], started: this.now(), answered: 0, newWords: 0, noListen: false };
    void this.save({ run: this.run });
    return this.run;
  }

  startStep(key: string): Run {
    const step = this.path.find((s) => s.key === key);
    if (!step) throw new Error(`Unknown step ${key}`);
    return this.begin(buildStep(this.ctx(), step));
  }

  startReview(): Run {
    return this.begin({ key: 'review', kind: 'review', title: 'Review', exercises: reviewRound(this.ctx(), 12) });
  }

  /** Practise a given list of cards (Progress → hardest words). */
  startPractice(ids: string[]): Run {
    const ctx = this.ctx();
    const ex = ids
      .map((id) => this.cards.get(id))
      .filter((c): c is CardRec => !!c)
      .map((c) => {
        const item = this.course.item(c.id);
        if (item?.word) return choiceMeaning(ctx, asRu(item.word), c.id, [this.course.unit(item.unit).words ?? []]);
        return null;
      })
      .filter((e): e is Exercise => !!e);
    return this.begin({ key: 'practice', kind: 'review', title: 'Practice', exercises: ex.length ? ex : reviewRound(ctx, 12) });
  }

  /** "Jump here": test on the units between the current one and the chosen one. */
  startJump(toUnit: number): Run {
    const from = this.currentStep()?.unit ?? 0;
    return this.begin(buildJumpTest(this.ctx(), from, toUnit));
  }

  canReview(): boolean {
    return [...this.cards.values()].some((c) => c.state !== 0);
  }

  // ------------------------------------------------------------ inside a lesson

  currentExercise(): Exercise | undefined {
    return this.run?.queue[this.run.pos];
  }

  private card(id: string, created: CardRec[]): CardRec {
    let c = this.cards.get(id);
    if (!c) {
      c = newCard(id, this.course.item(id)?.unit ?? 0, this.now());
      created.push(c);
      if (this.course.item(id)?.kind === 'word') {
        if (this.run) this.run.newWords++;
        this.pendingNew++;
      }
    }
    return c;
  }

  /** An ungraded intro card: the word now exists as a (new) review card. */
  seeIntro(ex: Exercise): void {
    if (ex.t !== 'intro' || !this.run) return;
    const id = this.course.items.has(idOf(ex)) ? idOf(ex) : undefined;
    const created: CardRec[] = [];
    if (id) {
      const c = this.card(id, created);
      this.cards.set(id, c);
    }
    void this.save({ cards: created });
  }

  answer(input: AnswerInput): void {
    const run = this.run;
    const ex = this.currentExercise();
    if (!run || !ex || !isGraded(ex)) return;
    const now = this.now();
    const correct = input.verdict !== 'wrong';
    const before: CardRec[] = [];
    const changed: CardRec[] = [];
    const created: CardRec[] = [];
    const repeat = isRepeat(ex);
    for (const id of cardsIn(ex)) {
      const old = this.cards.get(id);
      let c = this.card(id, created);
      if (old) before.push(old);
      const ok = ex.t === 'match' ? !(input.wrongCards ?? []).includes(id) : correct;
      c = countSeen(c, ok, now);
      if (!run.rated.includes(id) && !repeat) {
        const facts = { verdict: ex.t === 'match' ? (ok ? 'correct' : 'wrong') : input.verdict, typed: ex.t === 'type', seconds: input.secs, words: ex.t === 'type' ? ex.words : 1, replays: input.replays ?? 0 } as const;
        c = rate(c, ex.t === 'match' && ok ? Rating.Good : ratingFor(facts), now);
        run.rated.push(id);
      }
      this.cards.set(id, c);
      changed.push(c);
    }
    let firstKey: string | undefined;
    if (!repeat && !(ex.key in run.first)) {
      run.first[ex.key] = correct;
      firstKey = ex.key;
    }
    run.answered++;
    let requeued = false;
    if (run.plan.kind !== 'test') {
      if (ex.t === 'match') {
        const ctx = this.ctx();
        for (const id of input.wrongCards ?? []) {
          const w = this.course.item(id)?.word;
          const e = w && choiceMeaning(ctx, asRu(w), id, [this.course.unit(this.course.item(id)!.unit).words ?? []]);
          if (e) {
            run.queue = [...run.queue, markRepeat(e)];
            requeued = true;
          }
        }
      } else if (!correct) {
        run.queue = [...run.queue, markRepeat(again(this.ctx(), ex))];
        requeued = true;
      }
    }
    this.undo = { cards: before, requeued, firstKey, answer: input, ex };
    const day = this.bumpDay(now, input.secs, correct);
    void this.save({
      run,
      cards: [...created.filter((c) => !changed.includes(c)), ...changed],
      day,
      answer: { t: now, item: cardsIn(ex).join(',') || ex.key.split('#')[0], ex: exType(ex), plan: run.plan.key, verdict: input.verdict, secs: Math.round(input.secs * 10) / 10, given: input.given },
    });
  }

  /** "My answer was correct": take back a wrong verdict on a typed answer. */
  overrideLast(): void {
    const run = this.run;
    const u = this.undo;
    if (!run || !u || u.answer.verdict !== 'wrong') return;
    const now = this.now();
    const changed: CardRec[] = [];
    for (const id of cardsIn(u.ex)) {
      const prev = u.cards.find((c) => c.id === id) ?? newCard(id, this.course.item(id)?.unit ?? 0, now);
      let c = countSeen(prev, true, now);
      if (!isRepeat(u.ex)) c = rate(c, Rating.Good, now);
      this.cards.set(id, c);
      changed.push(c);
    }
    if (u.requeued) run.queue = run.queue.slice(0, -1);
    if (u.firstKey) run.first[u.firstKey] = true;
    this.undo = undefined;
    void this.save({ run, cards: changed, answer: { t: now, item: cardsIn(u.ex).join(','), ex: exType(u.ex), plan: run.plan.key, verdict: 'override', secs: 0, given: u.answer.given } });
  }

  /** "Can't listen now": listening exercises are replaced for the rest of this lesson. */
  noListen(): void {
    if (!this.run) return;
    this.run.noListen = true;
    const run = this.run;
    run.queue = run.queue.map((e, i) => {
      if (i < run.pos) return e;
      if (e.t === 'choice' && e.mode === 'listen') return { ...e, mode: 'russian', prompt: `Which one is “${e.show.en}”?` };
      if (e.t === 'type' && e.listen) return { ...e, listen: undefined };
      return e;
    });
    void this.save({ run });
  }

  next(): Outcome | null {
    const run = this.run;
    if (!run) return null;
    this.undo = undefined;
    run.pos++;
    if (run.pos < run.queue.length) {
      void this.save({ run });
      return null;
    }
    return this.finish();
  }

  /** Leave mid-lesson: nothing is lost, Continue resumes here. */
  leave(): Promise<void> {
    return this.flush();
  }

  abandon(): Promise<void> {
    this.run = undefined;
    return this.save({ run: null });
  }

  private finish(): Outcome {
    const run = this.run!;
    const results = Object.values(run.first);
    const total = results.length;
    const correct = results.filter(Boolean).length;
    const percent = total ? Math.round((correct / total) * 100) : 100;
    const passed = run.plan.passPercent ? percent >= run.plan.passPercent : true;
    const stars = !passed ? 0 : percent >= 95 ? 3 : percent >= 80 ? 2 : 1;
    const now = this.now();
    const stepsChanged: StepRec[] = [];
    if (passed) {
      if (run.plan.key.startsWith('jump:')) {
        const to = Number(run.plan.key.slice(5));
        const target = this.path.findIndex((s) => s.unit === to);
        for (let i = 0; i < target; i++) {
          const s = this.path[i];
          if (!this.steps.has(s.key)) {
            const rec: StepRec = { key: s.key, status: 'skipped', stars: 0, plays: 0, last: now };
            this.steps.set(s.key, rec);
            stepsChanged.push(rec);
          }
        }
      } else if (this.path.some((s) => s.key === run.plan.key)) {
        const old = this.steps.get(run.plan.key);
        const rec: StepRec = {
          key: run.plan.key,
          status: 'done',
          stars: Math.max(old?.status === 'done' ? old.stars : 0, stars),
          plays: (old?.plays ?? 0) + 1,
          last: now,
        };
        this.steps.set(rec.key, rec);
        stepsChanged.push(rec);
      }
    }
    const outcome: Outcome = {
      kind: run.plan.kind,
      key: run.plan.key,
      title: run.plan.title,
      correct,
      total,
      percent,
      passed,
      stars,
      newWords: run.newWords,
      passPercent: run.plan.passPercent,
      minutes: Math.max(1, Math.round((now - run.started) / 60000)),
    };
    this.run = undefined;
    void this.save({ run: null, steps: stepsChanged });
    return outcome;
  }

  // ------------------------------------------------------------ days and stats

  private bumpDay(now: number, secs: number, correct: boolean): DayRec {
    const key = todayKey(new Date(now));
    const d: DayRec = this.days.get(key) ?? { date: key, exercises: 0, seconds: 0, newWords: 0, correct: 0, dueAtStart: this.dueCount() };
    const next: DayRec = {
      ...d,
      exercises: d.exercises + 1,
      seconds: d.seconds + Math.min(60, Math.max(0, secs)),
      correct: d.correct + (correct ? 1 : 0),
      newWords: d.newWords + this.pendingNew,
    };
    this.pendingNew = 0;
    this.days.set(key, next);
    return next;
  }

  dueCount(): number {
    return dueCards(this.cards, this.now()).length;
  }

  stats() {
    const words = [...this.cards.values()].filter((c) => this.course.item(c.id)?.kind === 'word');
    const learned = words.filter((c) => c.learned).length;
    const strong = words.filter(isStrong).length;
    const unitsDone = this.course.units.filter((u) => {
      const steps = this.path.filter((s) => s.unit === u.number);
      return steps.length > 0 && steps.every((s) => this.steps.has(s.key));
    }).length;
    return { learned, strong, unitsDone, unitsTotal: this.course.units.length, due: this.dueCount(), daysUsed: [...this.days.values()].filter((d) => d.exercises > 0).length };
  }
}

const REPEAT = '~r';
function markRepeat<T extends Exercise>(e: T): T {
  return { ...e, key: e.key + REPEAT };
}
function isRepeat(e: Exercise): boolean {
  return e.key.endsWith(REPEAT);
}

function idOf(ex: Extract<Exercise, { t: 'intro' }>): string {
  return ex.key.slice('intro:'.length).split('#')[0];
}

function exType(e: Graded): string {
  return e.t === 'choice' ? e.mode : e.t;
}
