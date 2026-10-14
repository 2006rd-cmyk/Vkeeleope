import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Course } from '../src/content';
import type { Content, Unit } from '../src/types';

export function loadContent(): Content {
  const dir = join(__dirname, '..', 'content');
  const units = readdirSync(join(dir, 'lessons'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, 'lessons', f), 'utf8')) as Unit);
  return {
    version: 'test',
    units,
    synonyms: JSON.parse(readFileSync(join(dir, 'synonyms.json'), 'utf8')),
    nearForms: JSON.parse(readFileSync(join(dir, 'near-forms.json'), 'utf8')),
  };
}

export function loadCourse(): Course {
  return new Course(loadContent());
}
