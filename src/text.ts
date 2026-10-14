// Text helpers: stress marks, normalisation for answer checking, tokens, edit distance.

const ACUTE = /́/g;

/** Remove stress marks (combining acute). */
export function plain(s: string): string {
  return s.normalize('NFD').replace(ACUTE, '').normalize('NFC');
}

// Latin letters that look like Cyrillic ones; people with a phone keyboard sometimes mix them.
const LOOKALIKE: Record<string, string> = {
  a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к',
};

/**
 * Normalise a Russian answer for comparison (01-user-flow.md §6): lowercase, punctuation and
 * extra spaces ignored, ё = е, stress marks ignored.
 */
export function normRu(s: string): string {
  let t = plain(s).toLowerCase().replace(/ё/g, 'е');
  if (/[а-я]/.test(t)) t = t.replace(/[aceopxyk]/g, (ch) => LOOKALIKE[ch] ?? ch);
  t = t
    .replace(/[‐-―]/g, ' ') // dashes between clauses
    .replace(/(^|[^а-яa-z0-9])-+|-+(?=[^а-яa-z0-9]|$)/g, '$1 ') // hyphens not inside a word
    .replace(/[^а-яa-z0-9\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

export function normEn(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Russian word tokens of a sentence (plain, original case). */
export function ruTokens(s: string): string[] {
  return plain(s).match(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g) ?? [];
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Optimal string alignment distance, capped: returns 0, 1 or 2 (2 meaning "2 or more"),
 * plus the index of the first difference.
 */
export function oneEdit(a: string, b: string): { dist: 0 | 1 | 2; at: number } {
  if (a === b) return { dist: 0, at: -1 };
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ra = a.slice(i);
  const rb = b.slice(i);
  const rest = (x: string, y: string) => x === y;
  if (ra.length === rb.length) {
    if (rest(ra.slice(1), rb.slice(1))) return { dist: 1, at: i }; // substitution
    if (ra.length >= 2 && ra[0] === rb[1] && ra[1] === rb[0] && rest(ra.slice(2), rb.slice(2)))
      return { dist: 1, at: i }; // transposition
  } else if (ra.length === rb.length + 1) {
    if (rest(ra.slice(1), rb)) return { dist: 1, at: i }; // extra letter typed
  } else if (rb.length === ra.length + 1) {
    if (rest(ra, rb.slice(1))) return { dist: 1, at: i }; // letter missing
  }
  return { dist: 2, at: i };
}

export function shuffle<T>(arr: T[], rnd: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Small seeded PRNG (mulberry32), so tests can reproduce lessons. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
