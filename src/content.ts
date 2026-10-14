// Course content: loading and lookup indexes.
import type { Content, Drill, ReadingWord, RuItem, Sentence, Unit, Word } from './types';
import { normRu, plain, ruTokens } from './text';

/** Units in this build: A1, Units 1–21. The alphabet unit (0) was dropped after the trial: raud reads Cyrillic already. */
export const FIRST_UNIT = 1;
export const LAST_UNIT = 21;

export type CardKind = 'word' | 'sentence' | 'drill';

export interface CardItem {
  id: string;
  kind: CardKind;
  unit: number;
  word?: Word;
  sentence?: Sentence;
  drill?: Drill;
}

export class Course {
  readonly units: Unit[];
  readonly items = new Map<string, CardItem>();
  readonly gloss = new Map<string, Word>();
  readonly nearForms: Set<string>;
  readonly properNouns = new Set<string>();
  /** Every single-word form the course uses (normalised → as written), for "other ending" tiles. */
  readonly forms = new Map<string, string>();
  private readonly syn = new Map<string, Set<string>>();

  constructor(readonly content: Content) {
    this.units = content.units.filter((u) => u.number >= FIRST_UNIT && u.number <= LAST_UNIT).sort((a, b) => a.number - b.number);
    this.nearForms = new Set(content.nearForms);
    for (const group of content.synonyms) {
      for (const w of group) {
        const set = this.syn.get(w) ?? new Set<string>();
        group.forEach((x) => x !== w && set.add(x));
        this.syn.set(w, set);
      }
    }
    for (const u of this.units) {
      for (const w of u.words ?? []) {
        this.items.set(w.id, { id: w.id, kind: 'word', unit: u.number, word: w });
        const k = normRu(w.ru);
        if (!this.gloss.has(k)) this.gloss.set(k, w);
      }
      for (const s of u.sentences ?? []) {
        this.items.set(s.id, { id: s.id, kind: 'sentence', unit: u.number, sentence: s });
        this.collectNames(s.ru);
        s.word_bank?.answer.concat(s.word_bank.extra_tiles).forEach((t) => {
          if (/^[А-ЯЁ]/.test(t)) this.properNouns.add(t);
        });
      }
      for (const d of u.grammar_drills ?? []) this.items.set(d.id, { id: d.id, kind: 'drill', unit: u.number, drill: d });
      u.dialogue?.lines.forEach((l) => this.collectNames(l.ru));
    }
    // A form is shown in lower case if the course ever writes it that way mid-sentence or as a
    // word; otherwise it is a name (Таллин, Москве) and keeps its capital.
    const lower = new Set<string>();
    const first = new Map<string, string>();
    for (const it of this.items.values()) {
      const r = it.word?.ru ?? it.sentence?.ru ?? it.drill?.prompt.replace('___', it.drill.answer) ?? '';
      for (const sentence of plain(r).split(/[.!?—]+/)) {
        ruTokens(sentence).forEach((t, i) => {
          const n = normRu(t);
          if (!first.has(n)) first.set(n, t);
          if ((i > 0 || it.kind === 'word') && t === t.toLowerCase()) lower.add(n);
        });
      }
    }
    for (const [n, t] of first) this.forms.set(n, lower.has(n) ? t.toLowerCase() : t[0].toUpperCase() + t.slice(1).toLowerCase());
  }

  /** A word is a name if it is capitalised somewhere other than the start of a sentence. */
  private collectNames(ru: string) {
    for (const sentence of plain(ru).split(/[.!?—]+/)) {
      ruTokens(sentence).forEach((t, i) => {
        if (i > 0 && /^[А-ЯЁ]/.test(t)) this.properNouns.add(t);
      });
    }
  }

  unit(n: number): Unit {
    const u = this.units.find((x) => x.number === n);
    if (!u) throw new Error(`No unit ${n}`);
    return u;
  }

  item(id: string): CardItem | undefined {
    return this.items.get(id);
  }

  isSynonym(a: string, b: string): boolean {
    const x = normRu(a);
    const y = normRu(b);
    return this.syn.get(x)?.has(y) ?? false;
  }

  /** The grammar note that explains a drill's answer (the note that mentions the answer form). */
  grammarFor(unit: number, drill: Drill): string | undefined {
    const notes = this.unit(unit).grammar ?? [];
    const ans = normRu(drill.answer);
    const hit = notes.find((g) => normRu(g.explanation).split(' ').includes(ans));
    return hit ? `${hit.title}: ${firstSentence(hit.explanation)}` : undefined;
  }

  /** Meaning of a word as it appears in a text, if it is one of the course words. */
  lookup(token: string): Word | undefined {
    return this.gloss.get(normRu(token));
  }
}

function firstSentence(s: string): string {
  const m = s.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim();
}

export function asRu(x: Word | Sentence | ReadingWord | RuItem): RuItem {
  return { ru: x.ru, stress: x.stress, translit: x.translit, en: x.en };
}

export function cardRu(c: CardItem): RuItem {
  if (c.word) return asRu(c.word);
  if (c.sentence) return asRu(c.sentence);
  const d = c.drill!;
  const full = d.prompt.replace('___', d.answer);
  return { ru: full, stress: full, translit: '', en: d.en };
}

export async function loadContent(url = 'content.json'): Promise<Course> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the course (${res.status})`);
  return new Course((await res.json()) as Content);
}
