// Builds the exercises of every path step, review round and test from the unit data
// (04-exercise-types.md, 05-path-and-progress.md §1, 06-spaced-repetition.md §4–5).
import { asRu, cardRu, letterId, type CardItem, type Course } from './content';
import type { CardRec } from './srs';
import { isDue, retrievability } from './srs';
import { normRu, plain, ruTokens, shuffle } from './text';
import type { Letter, ReadingWord, RuItem, Sentence, Unit, Word } from './types';

export interface Option {
  text: string;
  /** Russian option: shown with the stress setting applied. */
  ru?: RuItem;
}

export type ChoiceMode = 'meaning' | 'russian' | 'listen' | 'letter' | 'read' | 'gap' | 'question';

export type Exercise =
  | { t: 'intro'; key: string; item: RuItem; letter?: Letter; note?: string; say?: string }
  | { t: 'note'; key: string; title: string; body: string }
  | { t: 'dialogue'; key: string; unit: number }
  | {
      t: 'choice';
      key: string;
      mode: ChoiceMode;
      cardId?: string;
      prompt: string;
      promptRu?: RuItem;
      letter?: string;
      hint?: string;
      options: Option[];
      answer: number;
      show: RuItem;
      why?: string;
    }
  | { t: 'match'; key: string; pairs: { cardId?: string; left: string; leftRu?: RuItem; right: string }[] }
  | { t: 'bank'; key: string; cardId?: string; en: string; tiles: string[]; accepted: string[]; show: RuItem }
  | { t: 'type'; key: string; cardId?: string; en: string; accepted: string[]; show: RuItem; words: number };

export type Graded = Extract<Exercise, { t: 'choice' | 'match' | 'bank' | 'type' }>;

export function isGraded(e: Exercise): e is Graded {
  return e.t === 'choice' || e.t === 'match' || e.t === 'bank' || e.t === 'type';
}

export type PlanKind = 'learn' | 'review' | 'test';

export interface LessonPlan {
  /** Path step key ("u3s2"), "review", or "jump:5" / "test". */
  key: string;
  kind: PlanKind;
  title: string;
  exercises: Exercise[];
  passPercent?: number;
}

export interface BuildCtx {
  course: Course;
  cards: Map<string, CardRec>;
  now: number;
  rnd: () => number;
  /** The phone has a Russian voice, so listening exercises can be used. */
  audio: boolean;
}

// ---------------------------------------------------------------- path definition

export interface StepDef {
  key: string;
  unit: number;
  index: number;
  kind: 'letters' | 'words' | 'grammar' | 'dialogue' | 'sentences' | 'review' | 'test' | 'checkpoint';
  title: string;
  icon: string;
}

const UNIT_STEPS: [StepDef['kind'], string, string][] = [
  ['words', 'New words 1', '📘'],
  ['words', 'New words 2', '📗'],
  ['grammar', 'Grammar', '✏️'],
  ['dialogue', 'Dialogue', '💬'],
  ['sentences', 'Sentences', '🧩'],
  ['review', 'Review', '🔁'],
  ['test', 'Unit test', '⭐'],
];

export function stepsOf(u: Unit): StepDef[] {
  if (u.kind === 'checkpoint') {
    return [{ key: `u${u.number}s1`, unit: u.number, index: 1, kind: 'checkpoint', title: u.title, icon: '🏆' }];
  }
  if (u.number === 0) {
    return (u.lessons ?? []).map((l, i) => ({
      key: `u0s${i + 1}`,
      unit: 0,
      index: i + 1,
      kind: i === (u.lessons ?? []).length - 1 ? 'test' : 'letters',
      title: l.title,
      icon: i === (u.lessons ?? []).length - 1 ? '⭐' : 'А',
    }));
  }
  return UNIT_STEPS.map(([kind, title, icon], i) => ({ key: `u${u.number}s${i + 1}`, unit: u.number, index: i + 1, kind, title, icon }));
}

export function allSteps(course: Course): StepDef[] {
  return course.units.flatMap(stepsOf);
}

// ---------------------------------------------------------------- helpers

let counter = 0;
function k(prefix: string): string {
  counter = (counter + 1) % 1e9;
  return `${prefix}#${counter.toString(36)}`;
}

function take<T>(arr: T[], n: number): T[] {
  return arr.slice(0, Math.max(0, n));
}

function sample<T>(ctx: BuildCtx, arr: T[], n: number): T[] {
  return take(shuffle(arr, ctx.rnd), n);
}

function wordsUpTo(course: Course, unit: number): Word[] {
  return course.units.filter((u) => u.number <= unit).flatMap((u) => u.words ?? []);
}

function sentencesUpTo(course: Course, unit: number): Sentence[] {
  return course.units.filter((u) => u.number <= unit).flatMap((u) => u.sentences ?? []);
}

/** Wrong options: same unit first, then earlier units; never the same meaning, form or a near-synonym. */
function distractors<T extends RuItem>(ctx: BuildCtx, target: T, pools: T[][], n: number, by: 'en' | 'ru'): T[] {
  const out: T[] = [];
  const seenEn = new Set([target.en.toLowerCase()]);
  const seenRu = new Set([normRu(target.ru)]);
  for (const pool of pools) {
    for (const c of shuffle(pool, ctx.rnd)) {
      if (out.length >= n) return out;
      const en = c.en.toLowerCase();
      const ru = normRu(c.ru);
      if (seenEn.has(en) || seenRu.has(ru)) continue;
      if (ctx.course.isSynonym(c.ru, target.ru)) continue;
      if (by === 'en' && sameMeaning(c.en, target.en)) continue;
      seenEn.add(en);
      seenRu.add(ru);
      out.push(c);
    }
  }
  return out;
}

/** "hi" vs "hi, hello" or "friend (male)" vs "friend": too close to be a fair wrong option when picking the English. */
function sameMeaning(a: string, b: string): boolean {
  const parts = (s: string) => new Set(s.toLowerCase().replace(/\(.*?\)/g, '').split(/[;,/]/).map((x) => x.trim()).filter(Boolean));
  const pa = parts(a);
  for (const p of parts(b)) if (pa.has(p)) return true;
  return false;
}

function placeAnswer(ctx: BuildCtx, right: Option, wrong: Option[]): { options: Option[]; answer: number } {
  const options = shuffle([right, ...wrong], ctx.rnd);
  return { options, answer: options.indexOf(right) };
}

// ---------------------------------------------------------------- exercise makers

export function introWord(w: Word): Exercise {
  return { t: 'intro', key: k(`intro:${w.id}`), item: asRu(w), note: w.note, say: w.say };
}

export function choiceMeaning(ctx: BuildCtx, item: RuItem, cardId: string | undefined, pools: RuItem[][]): Exercise | null {
  const wrong = distractors(ctx, item, pools, 3, 'en');
  if (wrong.length < 2) return null;
  const { options, answer } = placeAnswer(ctx, { text: item.en }, wrong.map((w) => ({ text: w.en })));
  return { t: 'choice', key: k(`meaning:${cardId ?? item.ru}`), mode: 'meaning', cardId, prompt: 'What does this mean?', promptRu: item, options, answer, show: item };
}

export function choiceRussian(ctx: BuildCtx, item: RuItem, cardId: string | undefined, pools: RuItem[][], listen = false): Exercise | null {
  const wrong = distractors(ctx, item, pools, 3, 'ru');
  if (wrong.length < 2) return null;
  const { options, answer } = placeAnswer(ctx, { text: item.ru, ru: item }, wrong.map((w) => ({ text: w.ru, ru: w })));
  if (listen && ctx.audio) {
    return { t: 'choice', key: k(`listen:${cardId ?? item.ru}`), mode: 'listen', cardId, prompt: 'Tap what you hear', promptRu: item, options, answer, show: item };
  }
  return { t: 'choice', key: k(`russian:${cardId ?? item.ru}`), mode: 'russian', cardId, prompt: `Which one is “${item.en}”?`, options, answer, show: item };
}

function matchWords(ctx: BuildCtx, words: Word[]): Exercise | null {
  const uniq: Word[] = [];
  for (const w of shuffle(words, ctx.rnd)) {
    if (uniq.some((u) => u.en.toLowerCase() === w.en.toLowerCase() || normRu(u.ru) === normRu(w.ru))) continue;
    uniq.push(w);
    if (uniq.length === 5) break;
  }
  if (uniq.length < 3) return null;
  return { t: 'match', key: k('match'), pairs: uniq.map((w) => ({ cardId: w.id, left: w.ru, leftRu: asRu(w), right: w.en })) };
}

export function gapDrill(ctx: BuildCtx, unit: number, drillId: string): Exercise {
  const d = ctx.course.item(drillId)!.drill!;
  const right = { text: d.answer };
  const others = d.options.filter((o) => o !== d.answer).map((o) => ({ text: o }));
  const { options, answer } = placeAnswer(ctx, right, others);
  const full = d.prompt.replace('___', d.answer);
  return {
    t: 'choice',
    key: k(`gap:${d.id}`),
    mode: 'gap',
    cardId: d.id,
    prompt: 'Fill the gap',
    hint: d.en,
    letter: d.prompt,
    options,
    answer,
    show: { ru: full, stress: full, translit: '', en: d.en },
    why: ctx.course.grammarFor(unit, d),
  };
}

function tileCase(course: Course, t: string): string {
  return course.properNouns.has(t) ? t : t.toLowerCase();
}

/** Word bank for a sentence (EN → RU tiles). Uses the written tiles when the sentence has them. */
export function bankSentence(ctx: BuildCtx, s: Sentence | (RuItem & { id?: string; accept_ru?: string[] }), extrasPool: string[]): Exercise | null {
  const accepted = [s.ru, ...(s.accept_ru ?? [])];
  let tiles: string[];
  const wb = 'word_bank' in s ? s.word_bank : undefined;
  if (wb) {
    tiles = [...wb.answer, ...wb.extra_tiles];
  } else {
    const answer = ruTokens(s.ru).map((t) => tileCase(ctx.course, t));
    if (answer.length < 2 || answer.length > 9) return null;
    const used = new Set(answer.map(normRu));
    const pool = shuffle(
      [...new Set(extrasPool.map((t) => tileCase(ctx.course, t)))].filter(
        (t) => !used.has(normRu(t)) && !answer.some((a) => ctx.course.isSynonym(a, t)),
      ),
      ctx.rnd,
    );
    const extras: string[] = [];
    // A capital letter must never give the answer away: if the answer has a name, add a name too.
    if (answer.some((t) => ctx.course.properNouns.has(t))) {
      const name = pool.find((t) => ctx.course.properNouns.has(t));
      if (name) extras.push(name);
    }
    for (const t of pool) {
      if (extras.length >= 3) break;
      if (!extras.includes(t)) extras.push(t);
    }
    tiles = [...answer, ...extras];
  }
  const id = 'id' in s ? s.id : undefined;
  return { t: 'bank', key: k(`bank:${id ?? s.ru}`), cardId: id, en: s.en, tiles: shuffle(tiles, ctx.rnd), accepted, show: asRu(s) };
}

export function typeItem(s: RuItem & { id?: string; accept_ru?: string[] }, cardId?: string): Exercise {
  const accepted = [s.ru, ...(s.accept_ru ?? [])];
  return { t: 'type', key: k(`type:${cardId ?? s.ru}`), cardId, en: s.en, accepted, show: asRu(s), words: ruTokens(s.ru).length };
}

// ---------------------------------------------------------------- unit 0 (alphabet)

function lettersOfLesson(u: Unit, lessonIdx: number): Letter[] {
  const l = (u.lessons ?? [])[lessonIdx];
  const all = u.letters ?? [];
  if (!l) return all;
  if (l.letters) return all.filter((x) => l.letters!.includes(x.letter));
  if (l.groups) return all.filter((x) => l.groups!.includes(x.group));
  return all;
}

function letterChoice(ctx: BuildCtx, all: Letter[], l: Letter): Exercise {
  const id = letterId(all.indexOf(l));
  const others: Letter[] = [];
  for (const x of shuffle(all, ctx.rnd)) {
    if (others.length === 3) break;
    if (x.translit !== l.translit && !others.some((o) => o.translit === x.translit)) others.push(x);
  }
  const { options, answer } = placeAnswer(ctx, { text: l.translit }, others.map((x) => ({ text: x.translit })));
  return {
    t: 'choice',
    key: k(`letter:${id}`),
    mode: 'letter',
    cardId: id,
    prompt: 'Which sound is this letter?',
    letter: l.letter,
    options,
    answer,
    show: { ru: l.example.ru, stress: l.example.stress, translit: l.example.translit, en: `${l.letter} = ${l.translit} · ${l.sound}` },
  };
}

function readChoice(ctx: BuildCtx, w: ReadingWord, pool: ReadingWord[]): Exercise | null {
  const fmt = (x: ReadingWord) => `${x.translit} · ${x.en}`;
  const others = shuffle(pool.filter((x) => x.ru !== w.ru && x.translit !== w.translit && x.en !== w.en), ctx.rnd).slice(0, 3);
  if (others.length < 2) return null;
  const { options, answer } = placeAnswer(ctx, { text: fmt(w) }, others.map((x) => ({ text: fmt(x) })));
  return { t: 'choice', key: k(`read:${w.ru}`), mode: 'read', prompt: 'Read this word', promptRu: asRu(w), options, answer, show: asRu(w) };
}

function letterLesson(ctx: BuildCtx, u: Unit, idx: number): Exercise[] {
  const all = u.letters ?? [];
  const letters = lettersOfLesson(u, idx);
  const lesson = (u.lessons ?? [])[idx];
  const groups = (u.groups ?? []).filter((g) => lesson?.groups?.includes(g.group));
  const known = all.filter((l) => (u.lessons ?? []).slice(0, idx + 1).some((_, i) => lettersOfLesson(u, i).includes(l)));
  let reading: ReadingWord[] = groups.flatMap((g) => g.reading_words);
  if (!reading.length) reading = letters.map((l) => l.example);
  const readPool = [...ctx.course.readingWords()];
  const out: Exercise[] = [];
  for (let i = 0; i < letters.length; i += 4) {
    const batch = letters.slice(i, i + 4);
    for (const l of batch) {
      if (!ctx.cards.has(letterId(all.indexOf(l)))) {
        out.push({ t: 'intro', key: k(`intro:${letterId(all.indexOf(l))}`), item: asRu(l.example), letter: l });
      }
    }
    for (const l of shuffle(batch, ctx.rnd)) out.push(letterChoice(ctx, known.length >= 4 ? known : all, l));
  }
  if (idx === 4) {
    for (const r of u.pronunciation_rules ?? []) out.push({ t: 'note', key: k('rule'), title: r.title, body: r.explanation });
  }
  const pairs = shuffle(letters.filter((l, i, a) => a.findIndex((x) => x.translit === l.translit) === i), ctx.rnd).slice(0, 5);
  if (pairs.length >= 3) out.push({ t: 'match', key: k('match'), pairs: pairs.map((l) => ({ cardId: letterId(all.indexOf(l)), left: l.letter, right: l.translit })) });
  for (const w of shuffle(reading, ctx.rnd).slice(0, 6)) {
    const e = readChoice(ctx, w, readPool);
    if (e) out.push(e);
  }
  for (const l of sample(ctx, letters, 3)) out.push(letterChoice(ctx, known.length >= 4 ? known : all, l));
  return out;
}

function alphabetTest(ctx: BuildCtx, n: number): Exercise[] {
  const u = ctx.course.unit(0);
  const all = u.letters ?? [];
  const pool = ctx.course.readingWords();
  const letters = sample(ctx, all, Math.ceil(n / 2)).map((l) => letterChoice(ctx, all, l));
  const reads = sample(ctx, pool, n)
    .map((w) => readChoice(ctx, w, pool))
    .filter((e): e is Exercise => !!e)
    .slice(0, n - letters.length);
  return shuffle([...letters, ...reads], ctx.rnd);
}

// ---------------------------------------------------------------- regular units

function wordsLesson(ctx: BuildCtx, u: Unit, words: Word[]): Exercise[] {
  const pools = [u.words ?? [], wordsUpTo(ctx.course, u.number)];
  const out: Exercise[] = [];
  let graded = 0;
  for (let i = 0; i < words.length; i += 4) {
    const batch = words.slice(i, i + 4);
    for (const w of batch) if (!ctx.cards.has(w.id)) out.push(introWord(w));
    for (const w of shuffle(batch, ctx.rnd)) {
      const e = choiceMeaning(ctx, asRu(w), w.id, pools);
      if (e) {
        out.push(e);
        graded++;
      }
    }
    if (batch.length >= 3 && (i / 4) % 2 === 1) {
      const m = matchWords(ctx, words.slice(Math.max(0, i - 4), i + 4));
      if (m) {
        out.push(m);
        graded++;
      }
    }
  }
  const second = shuffle(words, ctx.rnd).slice(0, Math.max(4, 15 - graded));
  second.forEach((w, i) => {
    const e = choiceRussian(ctx, asRu(w), w.id, pools, i % 2 === 0);
    if (e) out.push(e);
  });
  if (words.length >= 3 && words.length < 8) {
    const m = matchWords(ctx, words);
    if (m) out.push(m);
  }
  return out;
}

/** Sentences whose words are mostly known by now (for "first sentences" in New words 2). */
function easySentences(ctx: BuildCtx, u: Unit, n: number): Sentence[] {
  const known = new Set(wordsUpTo(ctx.course, u.number).map((w) => normRu(w.ru)));
  const scored = (u.sentences ?? [])
    .filter((s) => s.word_bank)
    .map((s) => {
      const t = ruTokens(s.ru);
      return { s, score: t.filter((x) => known.has(normRu(x))).length / t.length + ctx.rnd() * 0.05 };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((x) => x.s);
}

function extrasFor(ctx: BuildCtx, unit: number): string[] {
  return wordsUpTo(ctx.course, unit)
    .filter((w) => w.ru.indexOf(' ') < 0)
    .map((w) => w.ru);
}

function sentenceExercises(ctx: BuildCtx, u: Unit, sentences: Sentence[], plan: ('bank' | 'type' | 'meaning')[]): Exercise[] {
  const out: Exercise[] = [];
  const pools = [u.sentences ?? [], sentencesUpTo(ctx.course, u.number)];
  sentences.forEach((s, i) => {
    let want = plan[i % plan.length];
    if (want === 'bank' && !s.word_bank) want = 'type';
    let e: Exercise | null = null;
    if (want === 'bank') e = bankSentence(ctx, s, extrasFor(ctx, u.number));
    if (want === 'meaning') e = choiceMeaning(ctx, asRu(s), s.id, pools);
    if (!e) e = typeItem(s, s.id);
    out.push(e);
  });
  return out;
}

function dialogueLesson(ctx: BuildCtx, u: Unit): Exercise[] {
  const d = u.dialogue!;
  const out: Exercise[] = [{ t: 'dialogue', key: k(`dialogue:${u.number}`), unit: u.number }];
  for (const q of d.questions) {
    const right = { text: q.answer };
    const { options, answer } = placeAnswer(ctx, right, q.options.filter((o) => o !== q.answer).map((o) => ({ text: o })));
    out.push({ t: 'choice', key: k(`question:${u.number}`), mode: 'question', prompt: q.question, options, answer, show: { ru: '', stress: '', translit: '', en: q.answer } });
  }
  const lines = d.lines.map((l) => ({ ru: l.ru, stress: l.stress, translit: l.translit, en: l.en }));
  for (const l of sample(ctx, lines, 3)) {
    const e = choiceMeaning(ctx, l, undefined, [lines]);
    if (e) out.push(e);
  }
  const extras = lines.flatMap((l) => ruTokens(l.ru)).concat(extrasFor(ctx, u.number));
  const short = lines.filter((l) => ruTokens(l.ru).length <= 7);
  for (const l of sample(ctx, short, 2)) {
    const e = bankSentence(ctx, l, extras);
    if (e) out.push(e);
  }
  return out;
}

function grammarLesson(ctx: BuildCtx, u: Unit): Exercise[] {
  const out: Exercise[] = (u.grammar ?? []).map((g) => ({ t: 'note' as const, key: k('note'), title: g.title, body: g.explanation }));
  const drills = shuffle(u.grammar_drills ?? [], ctx.rnd);
  drills.forEach((d) => out.push(gapDrill(ctx, u.number, d.id)));
  const sents = sample(ctx, u.sentences ?? [], 4);
  out.push(...sentenceExercises(ctx, u, sents, ['bank', 'bank', 'type', 'bank']));
  sample(ctx, drills, 2).forEach((d) => out.push(gapDrill(ctx, u.number, d.id)));
  return out;
}

export function unitTest(ctx: BuildCtx, u: Unit): Exercise[] {
  const words = u.words ?? [];
  const pools = [words, wordsUpTo(ctx.course, u.number)];
  const out: Exercise[] = [];
  sample(ctx, words, 5).forEach((w, i) => {
    const e = i % 3 === 0 ? choiceMeaning(ctx, asRu(w), w.id, pools) : choiceRussian(ctx, asRu(w), w.id, pools, i % 3 === 2);
    if (e) out.push(e);
  });
  const m = matchWords(ctx, words);
  if (m) out.push(m);
  sample(ctx, u.grammar_drills ?? [], 4).forEach((d) => out.push(gapDrill(ctx, u.number, d.id)));
  out.push(...sentenceExercises(ctx, u, sample(ctx, u.sentences ?? [], 4), ['bank', 'type', 'bank', 'type']));
  const q = u.dialogue?.questions[0];
  if (q) {
    const { options, answer } = placeAnswer(ctx, { text: q.answer }, q.options.filter((o) => o !== q.answer).map((o) => ({ text: o })));
    out.push({ t: 'choice', key: k(`question:${u.number}`), mode: 'question', prompt: `${u.dialogue!.title}: ${q.question}`, options, answer, show: { ru: '', stress: '', translit: '', en: q.answer } });
  }
  return shuffle(out, ctx.rnd).slice(0, 15);
}

/** A few questions from one unit, for jump tests and checkpoints. */
function unitSample(ctx: BuildCtx, u: Unit, n: number): Exercise[] {
  if (u.number === 0) return alphabetTest(ctx, n);
  return unitTest(ctx, u).filter((e) => e.t !== 'match').slice(0, n);
}

// ---------------------------------------------------------------- reviews

/** The exercise for a review card follows its stability (06-spaced-repetition.md §4). */
export function reviewExercise(ctx: BuildCtx, rec: CardRec): Exercise | null {
  const item = ctx.course.item(rec.id);
  if (!item) return null;
  const s = rec.stability;
  const unit = ctx.course.unit(item.unit);
  switch (item.kind) {
    case 'letter':
      return letterChoice(ctx, unit.letters ?? [], item.letter!);
    case 'drill':
      return gapDrill(ctx, item.unit, item.id);
    case 'word': {
      const w = item.word!;
      const pools = [unit.words ?? [], wordsUpTo(ctx.course, LAST_SEEN(ctx))];
      if (s < 2) return ctx.rnd() < 0.6 ? choiceMeaning(ctx, asRu(w), w.id, pools) : choiceRussian(ctx, asRu(w), w.id, pools, true);
      if (s <= 10) return choiceRussian(ctx, asRu(w), w.id, pools, false);
      return typeItem(w, w.id);
    }
    case 'sentence': {
      const se = item.sentence!;
      const pools = [unit.sentences ?? [], sentencesUpTo(ctx.course, item.unit)];
      if (s < 2) return choiceMeaning(ctx, asRu(se), se.id, pools) ?? typeItem(se, se.id);
      if (s <= 10 && se.word_bank) return bankSentence(ctx, se, extrasFor(ctx, item.unit));
      return typeItem(se, se.id);
    }
  }
}

function LAST_SEEN(ctx: BuildCtx): number {
  let max = 0;
  for (const c of ctx.cards.values()) max = Math.max(max, c.unit);
  return max;
}

export function dueCards(cards: Map<string, CardRec>, now: number, maxUnit = Infinity): CardRec[] {
  return [...cards.values()].filter((c) => c.unit <= maxUnit && isDue(c, now)).sort((a, b) => a.due - b.due);
}

/**
 * Cards for a review round: due ones (most overdue first); if fewer than wanted, the weakest
 * (lowest chance of remembering), then random others, so practice is never empty.
 */
export function pickReviewCards(ctx: BuildCtx, n: number, maxUnit = Infinity): CardRec[] {
  const due = dueCards(ctx.cards, ctx.now, maxUnit).slice(0, n);
  if (due.length >= n) return due;
  const chosen = new Set(due.map((c) => c.id));
  const rest = [...ctx.cards.values()].filter((c) => c.unit <= maxUnit && !chosen.has(c.id));
  const weak = rest
    .map((c) => ({ c, r: retrievability(c, ctx.now) + ctx.rnd() * 0.02 }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.c);
  const half = Math.ceil((n - due.length) * 0.6);
  const weakest = weak.slice(0, half);
  const random = shuffle(weak.slice(half), ctx.rnd).slice(0, n - due.length - weakest.length);
  return [...due, ...weakest, ...random];
}

export function reviewRound(ctx: BuildCtx, n: number, maxUnit = Infinity): Exercise[] {
  return pickReviewCards(ctx, n, maxUnit)
    .map((c) => reviewExercise(ctx, c))
    .filter((e): e is Exercise => !!e);
}

// ---------------------------------------------------------------- plans

export function buildStep(ctx: BuildCtx, step: StepDef): LessonPlan {
  const u = ctx.course.unit(step.unit);
  const title = step.unit === 0 ? step.title : `${step.title} · ${u.title}`;
  const plan = (kind: PlanKind, exercises: Exercise[], passPercent?: number): LessonPlan => ({ key: step.key, kind, title, exercises, passPercent });
  switch (step.kind) {
    case 'letters':
      return plan('learn', letterLesson(ctx, u, step.index - 1));
    case 'words': {
      const words = u.words ?? [];
      const half = Math.ceil(words.length / 2);
      if (step.index === 1) return plan('learn', withMixedReviews(ctx, wordsLesson(ctx, u, words.slice(0, half)), step.unit));
      const ex = wordsLesson(ctx, u, words.slice(half));
      ex.push(...sentenceExercises(ctx, u, easySentences(ctx, u, 3), ['bank']));
      return plan('learn', withMixedReviews(ctx, ex, step.unit));
    }
    case 'grammar':
      return plan('learn', withMixedReviews(ctx, grammarLesson(ctx, u), step.unit));
    case 'dialogue':
      return plan('learn', dialogueLesson(ctx, u));
    case 'sentences': {
      const s = shuffle(u.sentences ?? [], ctx.rnd);
      return plan('learn', withMixedReviews(ctx, sentenceExercises(ctx, u, s, ['bank', 'bank', 'type', 'meaning', 'bank', 'type']), step.unit));
    }
    case 'review': {
      let ex = reviewRound(ctx, 15, step.unit);
      if (ex.length < 8) {
        // Not enough history yet: practise this unit's words and sentences.
        const pools = [u.words ?? [], wordsUpTo(ctx.course, u.number)];
        const extra = sample(ctx, u.words ?? [], 8 - ex.length)
          .map((w) => choiceRussian(ctx, asRu(w), w.id, pools, true))
          .filter((e): e is Exercise => !!e);
        ex = ex.concat(extra);
      }
      return plan('review', ex);
    }
    case 'test':
      if (step.unit === 0) return plan('test', alphabetTest(ctx, 15), 80);
      return plan('test', unitTest(ctx, u), 80);
    case 'checkpoint': {
      const covers = (u.covers ?? []).filter((n) => n !== u.number);
      return { key: step.key, kind: 'test', title: u.title, exercises: checkpointQuestions(ctx, covers, u.questions ?? 20), passPercent: u.pass_percent ?? 80 };
    }
  }
}

function checkpointQuestions(ctx: BuildCtx, covers: number[], n: number): Exercise[] {
  const units = covers.map((c) => ctx.course.unit(c));
  const per = Math.max(1, Math.ceil(n / units.length));
  const out = units.flatMap((u) => unitSample(ctx, u, u.number === 0 ? 2 : per));
  return shuffle(out, ctx.rnd).slice(0, n);
}

/** "Jump here": a test over every unit from `from` up to (not including) `to`. */
export function buildJumpTest(ctx: BuildCtx, from: number, to: number): LessonPlan {
  const units = ctx.course.units.filter((u) => u.number >= from && u.number < to && u.kind !== 'checkpoint');
  const per = units.length <= 2 ? 6 : units.length <= 4 ? 4 : 3;
  const ex = shuffle(units.flatMap((u) => unitSample(ctx, u, per)), ctx.rnd).slice(0, 25);
  const target = ctx.course.unit(to);
  return { key: `jump:${to}`, kind: 'test', title: `Jump to ${target.kind === 'checkpoint' ? target.title : `Unit ${to}`}`, exercises: ex, passPercent: 80 };
}

/** If more than 30 cards are due, every new lesson mixes in 3 of them (06 §5). */
function withMixedReviews(ctx: BuildCtx, ex: Exercise[], unit: number): Exercise[] {
  const due = dueCards(ctx.cards, ctx.now, unit);
  if (due.length <= 30) return ex;
  const extra = due.slice(0, 3).map((c) => reviewExercise(ctx, c)).filter((e): e is Exercise => !!e);
  const out = ex.slice();
  extra.forEach((e, i) => out.splice(Math.floor(((i + 1) * out.length) / (extra.length + 1)), 0, e));
  return out;
}

/** A fresh copy of an exercise (options re-shuffled) for when it comes back after a mistake. */
export function again(ctx: BuildCtx, e: Graded): Graded {
  const key = k(e.key.split('#')[0]);
  if (e.t === 'choice') {
    const right = e.options[e.answer];
    const options = shuffle(e.options, ctx.rnd);
    return { ...e, key, options, answer: options.indexOf(right) };
  }
  if (e.t === 'bank') return { ...e, key, tiles: shuffle(e.tiles, ctx.rnd) };
  return { ...e, key };
}

export function cardsIn(ex: Exercise): string[] {
  if (ex.t === 'match') return ex.pairs.map((p) => p.cardId).filter((x): x is string => !!x);
  if (isGraded(ex) && ex.cardId) return [ex.cardId];
  return [];
}

export function unitOfCard(course: Course, id: string): number {
  return course.item(id)?.unit ?? 0;
}

export function itemRu(item: CardItem): RuItem {
  return cardRu(item);
}

export { plain };
