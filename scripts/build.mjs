// Build Vire into dist/: bundle the app, pack the course content, write the offline service worker.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist');
const dev = process.argv.includes('--dev');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Course content: the lesson JSON written by vire/_build/build.py, plus checking data.
const lessonsDir = join(root, 'content', 'lessons');
const units = readdirSync(lessonsDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(lessonsDir, f), 'utf8')))
  .filter((u) => u.number >= 1 && u.number <= 21);
const content = {
  units,
  synonyms: JSON.parse(readFileSync(join(root, 'content', 'synonyms.json'), 'utf8')),
  nearForms: JSON.parse(readFileSync(join(root, 'content', 'near-forms.json'), 'utf8')),
};
const contentText = JSON.stringify(content);
const contentHash = createHash('sha256').update(contentText).digest('hex').slice(0, 10);
writeFileSync(join(out, 'content.json'), JSON.stringify({ version: contentHash, ...content }));

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const r = await build({
  entryPoints: [join(root, 'src', 'main.tsx')],
  bundle: true,
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  format: 'esm',
  target: ['es2020', 'safari15', 'chrome90', 'firefox90'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  outfile: join(out, 'app.js'),
  define: { __VERSION__: JSON.stringify(`${pkg.version}+${contentHash}`) },
  metafile: true,
  logLevel: 'warning',
});

cpSync(join(root, 'public'), out, { recursive: true });

// Every file is cached for offline use; the cache name changes whenever any file changes.
const files = [];
const walk = (dir, rel = '') => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) walk(join(dir, f.name), `${rel}${f.name}/`);
    else if (f.name !== 'sw.js') files.push(`${rel}${f.name}`);
  }
};
walk(out);
const hash = createHash('sha256');
for (const f of files.sort()) hash.update(f).update(readFileSync(join(out, f)));
const version = hash.digest('hex').slice(0, 12);
const sw = readFileSync(join(root, 'src', 'sw.js'), 'utf8')
  .replace('__CACHE__', `vire-${version}`)
  .replace('__FILES__', JSON.stringify(['./', ...files.filter((f) => f !== 'index.html' && !f.endsWith('.map'))]));
writeFileSync(join(out, 'sw.js'), sw);

const size = (f) => (existsSync(join(out, f)) ? (readFileSync(join(out, f)).length / 1024).toFixed(1) : '?');
console.log(`built dist/ (cache vire-${version}): app.js ${size('app.js')} KB, content.json ${size('content.json')} KB, ${files.length} files`);
if (r.errors.length) process.exit(1);
