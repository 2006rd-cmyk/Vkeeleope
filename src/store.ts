// Everything is saved on the phone, in IndexedDB, after every answer (05-path-and-progress.md §5).
import type { CardRec } from './srs';
import type { Exercise, LessonPlan } from './lessons';

export interface Settings {
  stress: boolean;
  translit: boolean;
  sound: boolean;
  slow: boolean;
  keyboard: 'vire' | 'phone';
  /** How hard lessons are: 'auto' follows recent accuracy (aiming at about 85% right). */
  challenge: 'auto' | 'normal' | 'hard';
}

export interface Profile {
  name: string;
  created: number;
  settings: Settings;
}

export interface StepRec {
  key: string;
  status: 'done' | 'skipped';
  stars: number;
  plays: number;
  last: number;
}

export interface Run {
  plan: LessonPlan;
  queue: Exercise[];
  pos: number;
  /** First-attempt result of each original graded exercise. */
  first: Record<string, boolean>;
  /** Cards already rated in this lesson (only the first answer to a card is rated). */
  rated: string[];
  started: number;
  /** Exercises answered (including repeats), for the "minutes" count. */
  answered: number;
  newWords: number;
  noListen: boolean;
}

export interface AnswerRec {
  id?: number;
  t: number;
  item: string;
  ex: string;
  plan: string;
  verdict: 'correct' | 'almost' | 'wrong' | 'override';
  secs: number;
  given?: string;
}

export interface DayRec {
  date: string;
  exercises: number;
  seconds: number;
  newWords: number;
  correct: number;
  dueAtStart?: number;
}

export interface FeedbackRec {
  id?: number;
  t: number;
  screen: string;
  item?: string;
  tag?: string;
  text: string;
}

export interface SessionRec {
  id?: number;
  opened: number;
  firstExercise?: number;
}

export interface Snapshot {
  profile?: Profile;
  steps: Map<string, StepRec>;
  cards: Map<string, CardRec>;
  days: Map<string, DayRec>;
  run?: Run;
}

const DB = 'vire';
const VERSION = 1;
const STORES = ['kv', 'steps', 'cards', 'answers', 'days', 'feedback', 'sessions'] as const;
type StoreName = (typeof STORES)[number];

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onabort = tx.onerror = () => rej(tx.error ?? new Error('Saving failed'));
  });
}

export class Store {
  private constructor(private db: IDBDatabase) {}

  static async open(name = DB): Promise<Store> {
    const r = indexedDB.open(name, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('kv');
      db.createObjectStore('steps', { keyPath: 'key' });
      db.createObjectStore('cards', { keyPath: 'id' });
      db.createObjectStore('answers', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('days', { keyPath: 'date' });
      db.createObjectStore('feedback', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
    };
    const db = await req(r);
    // Ask the browser not to clear our data under storage pressure.
    navigator.storage?.persist?.().catch(() => undefined);
    return new Store(db);
  }

  async load(): Promise<Snapshot> {
    const tx = this.db.transaction(['kv', 'steps', 'cards', 'days'], 'readonly');
    const [profile, run, steps, cards, days] = await Promise.all([
      req(tx.objectStore('kv').get('profile')),
      req(tx.objectStore('kv').get('run')),
      req(tx.objectStore('steps').getAll()),
      req(tx.objectStore('cards').getAll()),
      req(tx.objectStore('days').getAll()),
    ]);
    return {
      profile: profile as Profile | undefined,
      run: run as Run | undefined,
      steps: new Map((steps as StepRec[]).map((s) => [s.key, s])),
      cards: new Map((cards as CardRec[]).map((c) => [c.id, c])),
      days: new Map((days as DayRec[]).map((d) => [d.date, d])),
    };
  }

  /** One atomic write per answer: either all of it is saved or none of it. */
  async commit(w: {
    profile?: Profile;
    run?: Run | null;
    cards?: CardRec[];
    steps?: StepRec[];
    day?: DayRec;
    answer?: AnswerRec;
  }): Promise<void> {
    const tx = this.db.transaction(['kv', 'steps', 'cards', 'answers', 'days'], 'readwrite');
    const kv = tx.objectStore('kv');
    if (w.profile) kv.put(w.profile, 'profile');
    if (w.run === null) kv.delete('run');
    else if (w.run) kv.put(w.run, 'run');
    w.cards?.forEach((c) => tx.objectStore('cards').put(c));
    w.steps?.forEach((s) => tx.objectStore('steps').put(s));
    if (w.day) tx.objectStore('days').put(w.day);
    if (w.answer) tx.objectStore('answers').add(w.answer);
    await done(tx);
  }

  async addFeedback(f: FeedbackRec): Promise<void> {
    const tx = this.db.transaction('feedback', 'readwrite');
    tx.objectStore('feedback').add(f);
    await done(tx);
  }

  async addSession(s: SessionRec): Promise<number> {
    const tx = this.db.transaction('sessions', 'readwrite');
    const id = await req(tx.objectStore('sessions').add(s));
    await done(tx);
    return id as number;
  }

  async updateSession(s: SessionRec): Promise<void> {
    const tx = this.db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(s);
    await done(tx);
  }

  async all<T>(store: StoreName): Promise<T[]> {
    const tx = this.db.transaction(store, 'readonly');
    return (await req(tx.objectStore(store).getAll())) as T[];
  }

  async count(store: StoreName): Promise<number> {
    const tx = this.db.transaction(store, 'readonly');
    return req(tx.objectStore(store).count());
  }

  /** Everything, as one JSON-ready object (Save backup). */
  async exportAll(): Promise<Backup> {
    const out: Record<string, unknown> = {};
    for (const s of STORES) {
      if (s === 'kv') {
        const tx = this.db.transaction('kv', 'readonly');
        const keys = (await req(tx.objectStore('kv').getAllKeys())) as string[];
        const kv: Record<string, unknown> = {};
        for (const key of keys) kv[key] = await req(this.db.transaction('kv', 'readonly').objectStore('kv').get(key));
        out.kv = kv;
      } else {
        out[s] = await this.all(s);
      }
    }
    return { app: 'vire', format: 1, saved: new Date().toISOString(), data: out as Backup['data'] };
  }

  /** Replace everything with a backup (Load backup). Checked first, written in one transaction. */
  async importAll(b: Backup): Promise<void> {
    validateBackup(b);
    const tx = this.db.transaction([...STORES], 'readwrite');
    for (const s of STORES) tx.objectStore(s).clear();
    for (const [key, v] of Object.entries(b.data.kv)) tx.objectStore('kv').put(v, key);
    for (const s of STORES) {
      if (s === 'kv') continue;
      for (const row of b.data[s] as object[]) tx.objectStore(s).put(row);
    }
    await done(tx);
  }

  async wipe(): Promise<void> {
    const tx = this.db.transaction([...STORES], 'readwrite');
    for (const s of STORES) tx.objectStore(s).clear();
    await done(tx);
  }
}

export interface Backup {
  app: 'vire';
  format: 1;
  saved: string;
  data: {
    kv: Record<string, unknown>;
    steps: StepRec[];
    cards: CardRec[];
    answers: AnswerRec[];
    days: DayRec[];
    feedback: FeedbackRec[];
    sessions: SessionRec[];
  };
}

export function validateBackup(b: unknown): asserts b is Backup {
  const x = b as Backup;
  if (!x || x.app !== 'vire' || x.format !== 1 || !x.data) throw new Error('This is not a Vire backup file.');
  for (const s of STORES) {
    if (s === 'kv') {
      if (typeof x.data.kv !== 'object' || x.data.kv === null) throw new Error('The backup file is damaged (kv).');
    } else if (!Array.isArray(x.data[s])) {
      throw new Error(`The backup file is damaged (${s}).`);
    }
  }
  const p = x.data.kv.profile as Profile | undefined;
  if (p && typeof p.name !== 'string') throw new Error('The backup file is damaged (profile).');
  for (const c of x.data.cards) if (typeof c.id !== 'string' || typeof c.due !== 'number') throw new Error('The backup file is damaged (cards).');
}
