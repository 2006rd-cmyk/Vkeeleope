import { describe, expect, it } from 'vitest';
import { checkTiles, checkTyped } from '../src/check';
import { normRu, oneEdit } from '../src/text';
import { loadCourse } from './helpers';

const course = loadCourse();
const opts = { allowTypo: true, nearForms: course.nearForms };

describe('normalisation', () => {
  it('ignores case, punctuation, spaces, stress and ё', () => {
    expect(normRu('  Где ты  живёшь? ')).toBe('где ты живешь');
    expect(normRu('Э́то моя́ семья́.')).toBe('это моя семья');
    expect(normRu('Спасибо! — Пожалуйста!')).toBe('спасибо пожалуйста');
    expect(normRu('Я говорю по-русски.')).toBe('я говорю по-русски');
  });
  it('keeps й and ё distinct letters after removing stress', () => {
    expect(normRu('чай')).toBe('чай');
    expect(normRu('ещё')).toBe('еще');
  });
  it('maps Latin look-alike letters typed by mistake', () => {
    expect(normRu('кoт')).toBe('кот'); // Latin o
  });
});

describe('oneEdit', () => {
  it('finds single edits and their position', () => {
    expect(oneEdit('собака', 'сабака')).toEqual({ dist: 1, at: 1 });
    expect(oneEdit('собака', 'собак')).toEqual({ dist: 1, at: 5 });
    expect(oneEdit('собака', 'сбоака')).toEqual({ dist: 1, at: 1 });
    expect(oneEdit('собака', 'кошка').dist).toBe(2);
  });
});

describe('typed answers (01-user-flow §6)', () => {
  it('accepts exact answers and listed alternatives', () => {
    expect(checkTyped('у меня есть сестра и брат', ['У меня есть брат и сестра.', 'У меня есть сестра и брат.'], opts).verdict).toBe('correct');
  });
  it('does not forgive a wrong case ending', () => {
    const r = checkTyped('Я живу в Москва', ['Я живу в Москве.'], opts);
    expect(r.verdict).toBe('wrong');
    expect(r.note).toContain('москве');
  });
  it('forgives one typo in the stem of a long word', () => {
    expect(checkTyped('У меня есть сабака', ['У меня есть собака.'], opts).verdict).toBe('almost');
  });
  it('does not forgive typos in short words', () => {
    expect(checkTyped('Эта моя мама', ['Это моя мама.'], opts).verdict).toBe('wrong');
  });
  it('does not forgive a typo that makes another real word form', () => {
    // семья → семью is a real form (and in the ending anyway)
    expect(checkTyped('Это моя семью', ['Это моя семья.'], opts).verdict).toBe('wrong');
  });
  it('never forgives typos where typos are not allowed', () => {
    expect(checkTyped('сабака', ['собака'], { ...opts, allowTypo: false }).verdict).toBe('wrong');
  });
  it('rejects empty input', () => {
    expect(checkTyped('  ', ['да'], opts).verdict).toBe('wrong');
  });
});

describe('word bank', () => {
  it('compares built tiles ignoring case and punctuation', () => {
    expect(checkTiles(['её', 'зовут', 'Анна'], ['Её зовут Анна.'])).toBe('correct');
    expect(checkTiles(['зовут', 'её', 'Анна'], ['Её зовут Анна.'])).toBe('wrong');
  });
});
