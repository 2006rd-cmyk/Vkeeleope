// Spaced repetition with FSRS (06-spaced-repetition.md), through ts-fsrs.
import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';

export { Rating };

// Lessons are the short-term practice, so FSRS only schedules in days (no 1- and 10-minute steps).
const scheduler = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: true, enable_short_term: false }));

/** One review card as stored on the phone. Dates are epoch milliseconds so a backup is plain JSON. */
export interface CardRec {
  id: string;
  unit: number;
  due: number;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: number;
  seen: number;
  wrong: number;
  /** Answered correctly at least once ("Learned" on the progress chart). */
  learned: boolean;
  learnedAt?: number;
  created: number;
}

export function newCard(id: string, unit: number, now: number): CardRec {
  const c = createEmptyCard(new Date(now));
  return {
    id,
    unit,
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    seen: 0,
    wrong: 0,
    learned: false,
    created: now,
  };
}

function toCard(r: CardRec): Card {
  return {
    due: new Date(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: 0,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state as State,
    last_review: r.last_review ? new Date(r.last_review) : undefined,
  };
}

export function rate(r: CardRec, rating: Grade, now: number): CardRec {
  const next = scheduler.next(toCard(r), new Date(now), rating).card;
  return {
    ...r,
    due: next.due.getTime(),
    stability: next.stability,
    difficulty: next.difficulty,
    scheduled_days: next.scheduled_days,
    learning_steps: next.learning_steps,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
    last_review: now,
  };
}

/** Not rated in this session (practice repeat): only counts the attempt. */
export function countSeen(r: CardRec, correct: boolean, now: number): CardRec {
  const learnedNow = !r.learned && correct;
  return {
    ...r,
    seen: r.seen + 1,
    wrong: r.wrong + (correct ? 0 : 1),
    learned: r.learned || correct,
    learnedAt: learnedNow ? now : r.learnedAt,
  };
}

export function isDue(r: CardRec, now: number): boolean {
  return r.state !== State.New && r.due <= now;
}

/** Chance of remembering now, 0–1 (new cards count as 0). */
export function retrievability(r: CardRec, now: number): number {
  if (r.state === State.New || !r.last_review) return 0;
  return scheduler.get_retrievability(toCard(r), new Date(now), false);
}

export function isStrong(r: CardRec): boolean {
  return r.state !== State.New && r.stability >= 21;
}

export interface AnswerFacts {
  verdict: 'correct' | 'almost' | 'wrong';
  typed: boolean;
  seconds: number;
  words: number;
  replays: number;
}

/** 06-spaced-repetition.md §3: the rating comes from the answer, never from extra buttons. */
export function ratingFor(a: AnswerFacts): Grade {
  if (a.verdict === 'wrong') return Rating.Again;
  if (a.verdict === 'almost' || a.replays >= 2) return Rating.Hard;
  if (a.typed && a.seconds / Math.max(1, a.words) < 1.5) return Rating.Easy;
  return Rating.Good;
}
