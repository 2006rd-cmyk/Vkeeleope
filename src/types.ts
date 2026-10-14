// Content shapes, as written by vire/_build/build.py into lessons/*.json.

export interface Word {
  id: string;
  ru: string;
  stress: string;
  translit: string;
  en: string;
  pos: string;
  note?: string;
  say?: string;
}

export interface Sentence {
  id: string;
  ru: string;
  stress: string;
  translit: string;
  en: string;
  accept_en?: string[];
  accept_ru?: string[];
  word_bank?: { answer: string[]; extra_tiles: string[] };
}

export interface Drill {
  id: string;
  prompt: string;
  options: string[];
  answer: string;
  en: string;
}

export interface DialogueLine {
  speaker: string;
  ru: string;
  stress: string;
  translit: string;
  en: string;
}

export interface Dialogue {
  title: string;
  lines: DialogueLine[];
  questions: { question: string; options: string[]; answer: string }[];
}

export interface GrammarNote {
  title: string;
  explanation: string;
}

export interface ReadingWord {
  ru: string;
  stress: string;
  translit: string;
  en: string;
}

export interface Letter {
  letter: string;
  translit: string;
  sound: string;
  example: ReadingWord;
  group: number;
}

export interface Unit {
  id: string;
  level: string;
  section: string;
  number: number;
  title: string;
  goal: string;
  kind?: 'checkpoint';
  // regular units
  grammar?: GrammarNote[];
  words?: Word[];
  sentences?: Sentence[];
  grammar_drills?: Drill[];
  dialogue?: Dialogue;
  writing?: { id: string; prompt: string; use: string[]; model: { ru: string; stress: string } };
  // unit 0
  lessons?: { lesson: number; title: string; groups?: number[]; letters?: string[] }[];
  letters?: Letter[];
  groups?: { group: number; title: string; letters: string[]; reading_words: ReadingWord[] }[];
  pronunciation_rules?: GrammarNote[];
  // checkpoints
  covers?: number[];
  questions?: number;
  pass_percent?: number;
}

export interface Content {
  version: string;
  units: Unit[];
  synonyms: string[][];
  nearForms: string[];
}

/** Anything that can be shown as Russian with stress, transliteration and meaning. */
export interface RuItem {
  ru: string;
  stress: string;
  translit: string;
  en: string;
}
