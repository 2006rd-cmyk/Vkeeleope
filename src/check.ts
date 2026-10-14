// Answer checking for typed Russian (01-user-flow.md §6).
import { normRu, oneEdit } from './text';

export type Verdict = 'correct' | 'almost' | 'wrong';

export interface CheckResult {
  verdict: Verdict;
  /** Short explanation shown with the answer, e.g. "Check the ending: Москве". */
  note?: string;
}

export interface CheckOptions {
  /** Typos may be forgiven (translation and dictation only, never gap fills or word banks). */
  allowTypo: boolean;
  /** Real word forms one edit away from course words; a typo that makes one of these is a grammar error. */
  nearForms: Set<string>;
}

export function checkTyped(input: string, accepted: string[], opts: CheckOptions): CheckResult {
  const n = normRu(input);
  if (!n) return { verdict: 'wrong' };
  const targets = accepted.map(normRu);
  if (targets.includes(n)) return { verdict: 'correct' };

  const got = n.split(' ');
  let endingNote: string | undefined;
  for (const t of targets) {
    const exp = t.split(' ');
    if (exp.length !== got.length) continue;
    const diff: number[] = [];
    for (let i = 0; i < exp.length; i++) if (exp[i] !== got[i]) diff.push(i);
    if (diff.length !== 1) continue;
    const e = exp[diff[0]];
    const g = got[diff[0]];
    const { dist, at } = oneEdit(e, g);
    const inEnding = at >= e.length - 3 || at >= g.length - 3;
    if (
      opts.allowTypo &&
      dist === 1 &&
      e.length >= 5 &&
      !inEnding &&
      !opts.nearForms.has(g)
    ) {
      return { verdict: 'almost', note: `Almost: check the spelling of ${e}` };
    }
    // Same stem, different ending: say so (the ending is usually the grammar).
    const stemLen = Math.max(1, Math.min(e.length, g.length) - 3);
    if (!endingNote && e.length >= 3 && g.length >= 2 && e.slice(0, stemLen) === g.slice(0, stemLen) && at >= stemLen) {
      endingNote = `Wrong ending: ${e}, not ${g}`;
    }
  }
  return { verdict: 'wrong', note: endingNote };
}

/** Word-bank answers: the built sequence must equal an accepted answer (case and punctuation ignored). */
export function checkTiles(tiles: string[], accepted: string[]): Verdict {
  const n = normRu(tiles.join(' '));
  return accepted.some((a) => normRu(a) === n) ? 'correct' : 'wrong';
}
