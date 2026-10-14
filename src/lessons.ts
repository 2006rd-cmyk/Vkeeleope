// Builds the exercises of every path step, review round and test from the unit data
// (04-exercise-types.md, 05-path-and-progress.md §1, 06-spaced-repetition.md §4–5).
import { asRu, cardRu, type CardItem, type Course } from './content';
import type { CardRec } from './srs';
import { isDue, retrievability } from './srs';
import { normRu, plain, ruTokens, shuffle } from './text';
import type { RuItem, Sentence, Unit, Word } from './types';

export interface Option {
  text: string;
  /** Russian option: shown with the stress setting applied. */
  ru?: RuItem;
}

export type ChoiceMode = 'meaning' | 'russian' | 'listen' | 'gap' | 'question';

export type Exercise =
  | { t: 'intro'; key: string; item: RuItem; note?: string; say?: string }
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
  | {
      t: 'type';
      key: string;
      cardId?: string;
      en: string;
      accepted: string[];
      show: RuItem;
      words: number;
      /** Dictation: the prompt is the Russian audio, not the English. */
      listen?: boolean;
      /** Typed gap: the Russian sentence with "___" for the missing word. */
      gap?: string;
      why?: string;
    };

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
  /**
   * Challenge level (0 = easier, 1 = normal, 2 = hard). Higher levels ask for more typing and
   * dictation and fewer multiple-choice taps; Model picks it from recent accuracy (aim ≈ 85%).
   */
  level?: Level;
}

export type Level = 0 | 1 | 2;
const lvl = (ctx: BuildCtx): Level => ctx.level ?? 1;

// ---------------------------------------------------------------- path definition

export interface StepDef {
  key: string;
  unit: number;
  index: number;
  kind: 'words' | 'grammar' | 'dialogue' | 'sentences' | 'review' | 'test' | 'checkpoint';
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
    for (const t of nearFormTiles(ctx, answer, 2)) if (!extras.includes(t)) extras.push(t);
    const want = lvl(ctx) === 0 ? 3 : lvl(ctx) === 1 ? 4 : 5;
    for (const t of pool) {
      if (extras.length >= want) break;
      if (!extras.includes(t)) extras.push(t);
    }
    tiles = [...answer, ...extras];
  }
  if (wb && lvl(ctx) > 0) {
    // Written tiles: add other forms of the answer's words, so the ending has to be chosen.
    const answer = wb.answer;
    for (const t of nearFormTiles(ctx, answer, lvl(ctx))) if (!tiles.some((x) => normRu(x) === normRu(t))) tiles.push(t);
  }
  const id = 'id' in s ? s.id : undefined;
  return { t: 'bank', key: k(`bank:${id ?? s.ru}`), cardId: id, en: s.en, tiles: shuffle(tiles, ctx.rnd), accepted, show: asRu(s) };
}

export function typeItem(s: RuItem & { id?: string; accept_ru?: string[] }, cardId?: string, listen = false): Exercise {
  const accepted = [s.ru, ...(s.accept_ru ?? [])];
  return { t: 'type', key: k(`${listen ? 'dictation' : 'type'}:${cardId ?? s.ru}`), cardId, en: s.en, accepted, show: asRu(s), words: ruTokens(s.ru).length, listen: listen || undefined };
}

/** Dictation when the phone can speak Russian, otherwise typing from the English. */
function dictation(ctx: BuildCtx, s: RuItem & { id?: string; accept_ru?: string[] }, cardId?: string): Exercise {
  return typeItem(s, cardId, ctx.audio);
}

/** A grammar drill with the missing word typed instead of picked. */
export function typedGap(ctx: BuildCtx, unit: number, drillId: string): Exercise {
  const d = ctx.course.item(drillId)!.drill!;
  const full = d.prompt.replace('___', d.answer);
  return {
    t: 'type',
    key: k(`gaptype:${d.id}`),
    cardId: d.id,
    en: d.en,
    accepted: [d.answer],
    show: { ru: full, stress: full, translit: '', en: d.en },
    words: 1,
    gap: d.prompt,
    why: ctx.course.grammarFor(unit, d),
  };
}

const ADJ = /(ый|ий|ой|ая|яя|ое|ее|ые|ие)$/;
const GENDER_ADD = ['а', 'о', 'и', 'ка'];

/**
 * Forms that differ only by gender or number (был/была, русский/русская, студент/студентка) can
 * both be right when the English does not say who is speaking, so they are never used as traps.
 */
function genderPair(a: string, b: string): boolean {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.startsWith(s) && GENDER_ADD.includes(l.slice(s.length))) return true;
  // был/была/было/были, ходил/ходила: past-tense endings
  if (/л[аои]?$/.test(a) && /л[аои]?$/.test(b) && a.replace(/л[аои]?$/, '') === b.replace(/л[аои]?$/, '')) return true;
  return ADJ.test(a) && ADJ.test(b) && a.replace(ADJ, '') === b.replace(ADJ, '');
}

/**
 * Other forms of the answer's words (same stem, different ending) that the course uses somewhere,
 * e.g. живу → живёт. As extra tiles they make the learner choose the ending, not just the word.
 */
function nearFormTiles(ctx: BuildCtx, answer: string[], n: number): string[] {
  if (n <= 0) return [];
  const forms = ctx.course.forms;
  const used = new Set(answer.map(normRu));
  const out: string[] = [];
  for (const a of shuffle(answer, ctx.rnd)) {
    const x = normRu(a);
    if (x.length < 3) continue;
    const stem = x.slice(0, Math.max(3, x.length - 2));
    const hits = shuffle(
      [...forms.keys()].filter((f) => !used.has(f) && f.startsWith(stem) && Math.abs(f.length - x.length) <= 2 && !ctx.course.isSynonym(f, x) && !genderPair(f, x)),
      ctx.rnd,
    );
    if (hits.length) {
      out.push(forms.get(hits[0])!);
      used.add(hits[0]);
    }
    if (out.length >= n) break;
  }
  return out;
}

// ---------------------------------------------------------------- regular units

function wordsLesson(ctx: BuildCtx, u: Unit, words: Word[]): Exercise[] {
  const pools = [u.words ?? [], wordsUpTo(ctx.course, u.number)];
  const out: Exercise[] = [];
  let graded = 0;
  // 1. Meet the words: each one shown, then recognised once.
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
  // 2. Produce them: recall the Russian from the English, or write what you hear.
  // Recall is what makes words stick (testing effect), so typing comes before more tapping.
  const level = lvl(ctx);
  const room = Math.max(4, 25 - graded);
  shuffle(words, ctx.rnd)
    .slice(0, room)
    .forEach((w, i) => {
      let e: Exercise | null;
      if (level === 0) e = choiceRussian(ctx, asRu(w), w.id, pools, i % 2 === 0);
      else if (i % 3 === 2) e = level === 2 ? dictation(ctx, w, w.id) : choiceRussian(ctx, asRu(w), w.id, pools, true);
      else e = typeItem(w, w.id);
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

type SentencePlan = ('bank' | 'type' | 'meaning' | 'listen')[];

function sentenceExercises(ctx: BuildCtx, u: Unit, sentences: Sentence[], plan: SentencePlan): Exercise[] {
  const out: Exercise[] = [];
  const pools = [u.sentences ?? [], sentencesUpTo(ctx.course, u.number)];
  sentences.forEach((s, i) => {
    let want = plan[i % plan.length];
    if (want === 'bank' && !s.word_bank) want = 'type';
    let e: Exercise | null = null;
    if (want === 'bank') e = bankSentence(ctx, s, extrasFor(ctx, u.number));
    if (want === 'meaning') e = choiceMeaning(ctx, asRu(s), s.id, pools);
    if (want === 'listen') e = dictation(ctx, s, s.id);
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
  const plan: SentencePlan = [['bank', 'bank', 'type', 'bank'], ['bank', 'type', 'bank', 'type'], ['type', 'bank', 'type', 'type']][lvl(ctx)] as SentencePlan;
  out.push(...sentenceExercises(ctx, u, sents, plan));
  // The same patterns again at the end, now typed: recall the form instead of recognising it.
  sample(ctx, drills, lvl(ctx) === 2 ? 3 : 2).forEach((d) => out.push(lvl(ctx) === 0 ? gapDrill(ctx, u.number, d.id) : typedGap(ctx, u.number, d.id)));
  return out;
}

export function unitTest(ctx: BuildCtx, u: Unit): Exercise[] {
  const words = u.words ?? [];
  const pools = [words, wordsUpTo(ctx.course, u.number)];
  const out: Exercise[] = [];
  const level = lvl(ctx);
  sample(ctx, words, 5).forEach((w, i) => {
    let e: Exercise | null;
    if (level === 0) e = i % 3 === 0 ? choiceMeaning(ctx, asRu(w), w.id, pools) : choiceRussian(ctx, asRu(w), w.id, pools, i % 3 === 2);
    else if (i === 1) e = dictation(ctx, w, w.id);
    else if (i === 4 && level === 1) e = choiceRussian(ctx, asRu(w), w.id, pools, true);
    else e = typeItem(w, w.id);
    if (e) out.push(e);
  });
  const m = matchWords(ctx, words);
  if (m) out.push(m);
  sample(ctx, u.grammar_drills ?? [], 4).forEach((d, i) => out.push(level > 0 && i % 2 === 1 ? typedGap(ctx, u.number, d.id) : gapDrill(ctx, u.number, d.id)));
  const plan: SentencePlan = level === 0 ? ['bank', 'type', 'bank', 'type'] : level === 1 ? ['bank', 'type', 'listen', 'type'] : ['type', 'listen', 'type', 'bank'];
  out.push(...sentenceExercises(ctx, u, sample(ctx, u.sentences ?? [], 4), plan));
  const q = u.dialogue?.questions[0];
  if (q) {
    const { options, answer } = placeAnswer(ctx, { text: q.answer }, q.options.filter((o) => o !== q.answer).map((o) => ({ text: o })));
    out.push({ t: 'choice', key: k(`question:${u.number}`), mode: 'question', prompt: `${u.dialogue!.title}: ${q.question}`, options, answer, show: { ru: '', stress: '', translit: '', en: q.answer } });
  }
  return shuffle(out, ctx.rnd).slice(0, 15);
}

/** A few questions from one unit, for jump tests and checkpoints. */
function unitSample(ctx: BuildCtx, u: Unit, n: number): Exercise[] {
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
    case 'drill':
      return s < 2 || lvl(ctx) === 0 ? gapDrill(ctx, item.unit, item.id) : typedGap(ctx, item.unit, item.id);
    case 'word': {
      const w = item.word!;
      const pools = [unit.words ?? [], wordsUpTo(ctx.course, LAST_SEEN(ctx))];
      if (lvl(ctx) === 0) {
        if (s < 2) return ctx.rnd() < 0.6 ? choiceMeaning(ctx, asRu(w), w.id, pools) : choiceRussian(ctx, asRu(w), w.id, pools, true);
        if (s <= 10) return choiceRussian(ctx, asRu(w), w.id, pools, false);
        return typeItem(w, w.id);
      }
      // Recall from early on; the steps up are: pick by ear → type from English → type what you hear.
      if (s < 1) return choiceRussian(ctx, asRu(w), w.id, pools, true) ?? typeItem(w, w.id);
      if (s <= 7) return typeItem(w, w.id);
      return ctx.rnd() < 0.5 ? dictation(ctx, w, w.id) : typeItem(w, w.id);
    }
    case 'sentence': {
      const se = item.sentence!;
      const pools = [unit.sentences ?? [], sentencesUpTo(ctx.course, item.unit)];
      const easy = lvl(ctx) === 0 ? 10 : 3;
      if (s < 2 && lvl(ctx) === 0) return choiceMeaning(ctx, asRu(se), se.id, pools) ?? typeItem(se, se.id);
      if (s <= easy && se.word_bank) return bankSentence(ctx, se, extrasFor(ctx, item.unit));
      return lvl(ctx) > 0 && ctx.rnd() < 0.4 ? dictation(ctx, se, se.id) : typeItem(se, se.id);
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
  const title = `${step.title} · ${u.title}`;
  const plan = (kind: PlanKind, exercises: Exercise[], passPercent?: number): LessonPlan => ({ key: step.key, kind, title, exercises, passPercent });
  switch (step.kind) {
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
      const plans: SentencePlan[] = [
        ['bank', 'bank', 'type', 'meaning', 'bank', 'type'],
        ['bank', 'type', 'listen', 'type', 'bank', 'type'],
        ['type', 'listen', 'type', 'bank', 'type', 'listen'],
      ];
      return plan('learn', withMixedReviews(ctx, sentenceExercises(ctx, u, s, plans[lvl(ctx)]), step.unit));
    }
    case 'review': {
      let ex = reviewRound(ctx, 15, step.unit);
      if (ex.length < 8) {
        // Not enough history yet: practise this unit's words and sentences.
        const pools = [u.words ?? [], wordsUpTo(ctx.course, u.number)];
        const extra = sample(ctx, u.words ?? [], 8 - ex.length)
          .map((w, i) => (lvl(ctx) > 0 && i % 2 === 1 ? typeItem(w, w.id) : choiceRussian(ctx, asRu(w), w.id, pools, true)))
          .filter((e): e is Exercise => !!e);
        ex = ex.concat(extra);
      }
      return plan('review', ex);
    }
    case 'test':
      return plan('test', unitTest(ctx, u), 80);
    case 'checkpoint': {
      const covers = (u.covers ?? []).filter((n) => n !== u.number && ctx.course.units.some((x) => x.number === n && x.kind !== 'checkpoint'));
      return { key: step.key, kind: 'test', title: u.title, exercises: checkpointQuestions(ctx, covers, u.questions ?? 20), passPercent: u.pass_percent ?? 80 };
    }
  }
}

function checkpointQuestions(ctx: BuildCtx, covers: number[], n: number): Exercise[] {
  const units = covers.map((c) => ctx.course.unit(c));
  const per = Math.max(1, Math.ceil(n / units.length));
  const out = units.flatMap((u) => unitSample(ctx, u, per));
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

/**
 * New lessons mix in a few older items (spacing and interleaving): 3 when more than 30 cards are
 * due (06 §5); on normal and hard levels always up to 3 from earlier units, due or weakest first.
 */
function withMixedReviews(ctx: BuildCtx, ex: Exercise[], unit: number): Exercise[] {
  const due = dueCards(ctx.cards, ctx.now, unit);
  let cards: CardRec[] = [];
  if (due.length > 30) cards = due.slice(0, 3);
  else if (lvl(ctx) > 0) cards = pickReviewCards(ctx, 3, unit - 1);
  if (!cards.length) return ex;
  const extra = cards.map((c) => reviewExercise(ctx, c)).filter((e): e is Exercise => !!e);
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
