// End-to-end test in a phone-sized Chromium: node tests/e2e.mjs [--full]
// Serves dist/ itself, so run `npm run build` first.
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const FULL = process.argv.includes('--full');
const dist = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(dist, p);
  if (!existsSync(f) || !statSync(f).isFile()) return res.writeHead(404).end('not found');
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(readFileSync(f));
}).listen(0);
const URL_ = `http://localhost:${server.address().port}/`;

const exe = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(exe && existsSync(exe) ? { executablePath: exe } : {});
const phone = { ...devices['iPhone 13'] };
delete phone.defaultBrowserType;
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
};
const log = (...a) => console.log('·', ...a);

const norm = (s) => s.normalize('NFD').replace(/́/g, '').normalize('NFC').toLowerCase().replace(/ё/g, 'е');
const words = (s) => (s.normalize('NFD').replace(/́/g, '').normalize('NFC').match(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g) ?? []);

async function current(page) {
  return page.evaluate(() => {
    const m = window.__vire.model;
    const e = m.currentExercise();
    return e ? JSON.parse(JSON.stringify(e)) : null;
  });
}

/** Answer the current exercise through the UI. wrong=true answers it wrongly on purpose. */
async function solve(page, wrong = false) {
  const ex = await current(page);
  if (!ex) return null;
  switch (ex.t) {
    case 'intro':
    case 'note':
      await page.locator('.lesson-foot .btn').click();
      return ex;
    case 'dialogue':
      while (await page.getByRole('button', { name: 'Next line' }).count()) await page.getByRole('button', { name: 'Next line' }).click();
      await page.getByRole('button', { name: 'Continue to questions' }).click();
      return ex;
    case 'choice': {
      const i = wrong ? (ex.answer + 1) % ex.options.length : ex.answer;
      await page.locator('.options .option').nth(i).click();
      await page.getByRole('button', { name: 'Check' }).click();
      await page.locator('.feedback').waitFor();
      await page.locator('.feedback .btn').click();
      return ex;
    }
    case 'match': {
      const left = page.locator('.match-col').first().locator('.option');
      for (let i = 0; i < ex.pairs.length; i++) {
        await left.nth(i).click();
        await page.locator(`.match-col >> nth=1 >> [data-pair="${i}"]`).click();
      }
      await page.waitForFunction((k) => window.__vire.model.currentExercise()?.key !== k, ex.key);
      return ex;
    }
    case 'bank': {
      const need = words(ex.accepted[0]);
      const pool = page.locator('.bank-pool .tile');
      const texts = await pool.allInnerTexts();
      const used = new Set();
      const order = wrong ? [...need].reverse() : need;
      for (const w of order) {
        const i = texts.findIndex((t, j) => !used.has(j) && norm(t) === norm(w));
        assert.ok(i >= 0, `tile ${w} missing in ${texts}`);
        used.add(i);
        await pool.nth(i).click();
      }
      await page.getByRole('button', { name: 'Check' }).click();
      await page.locator('.feedback').waitFor();
      await page.locator('.feedback .btn').last().click();
      return ex;
    }
    case 'type': {
      const text = wrong ? 'нет' : words(ex.accepted[0]).join(' ').toLowerCase();
      for (const ch of text) {
        const label = ch === ' ' ? 'space' : ch === '-' ? 'hyphen' : ch;
        await page.locator(`.kb [aria-label="${label}"]`).dispatchEvent('pointerdown');
      }
      await page.getByRole('button', { name: 'Check' }).click();
      await page.locator('.feedback').waitFor();
      const ok = await page.locator('.feedback.ok').count();
      assert.equal(!!ok, !wrong, `typed "${text}" for ${ex.accepted[0]}`);
      await page.locator('.feedback .btn').last().click();
      return ex;
    }
  }
}

async function playLesson(page, { wrongFirst = 0 } = {}) {
  let wrongLeft = wrongFirst;
  for (let guard = 0; guard < 400; guard++) {
    if (await page.locator('.result').count()) return;
    const ex = await current(page);
    if (!ex) {
      await page.locator('.result').waitFor({ timeout: 5000 });
      return;
    }
    const graded = ['choice', 'bank', 'type'].includes(ex.t);
    await solve(page, graded && wrongLeft-- > 0);
  }
  throw new Error('lesson did not end');
}

async function onboard(page, name = 'raud') {
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.path').waitFor();
}

// ---------------------------------------------------------------- 1. first launch + first lesson
const ctx = await browser.newContext({ ...phone, acceptDownloads: true });
const page = await ctx.newPage();
watch(page);
await onboard(page);
assert.match(await page.locator('.hello').innerText(), /Привет, raud!/);
log('onboarding ok');

await page.getByRole('button', { name: /^Continue/ }).click();
await playLesson(page, { wrongFirst: 1 });
const resultText = await page.locator('.result').innerText();
assert.match(resultText, /Lesson done!/);
log('lesson u0s1 finished with one mistake:', resultText.replace(/\s+/g, ' ').slice(0, 80));
await page.getByRole('button', { name: 'Back to the path' }).click();
assert.equal(await page.locator('[data-step="u0s1"]').getAttribute('class'), 'node done');
assert.equal(await page.locator('[data-step="u0s2"]').getAttribute('class'), 'node current');

// ---------------------------------------------------------------- 2. leaving mid-lesson loses nothing
await page.getByRole('button', { name: /^Continue/ }).click();
for (let i = 0; i < 6; i++) await solve(page);
const before = await current(page);
const pos = await page.evaluate(() => window.__vire.model.run.pos);
await page.reload();
await page.locator('.path').waitFor();
assert.match(await page.locator('.hero').innerText(), /Continue lesson/i);
await page.getByRole('button', { name: /Continue lesson/i }).click();
const after = await current(page);
assert.equal(after.key, before.key);
assert.equal(await page.evaluate(() => window.__vire.model.run.pos), pos);
log('reload mid-lesson resumes at exercise', pos);
await playLesson(page);
await page.getByRole('button', { name: 'Back to the path' }).click();

// ---------------------------------------------------------------- 3. offline + cold start
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForFunction(() => !!navigator.serviceWorker.controller);
await ctx.setOffline(true);
const t0 = Date.now();
await page.reload();
await page.locator('.path').waitFor();
const coldMs = Date.now() - t0;
log(`offline reload shows the path in ${coldMs} ms`);
assert.ok(coldMs < 2000, 'opens in under 2 s offline');
await page.getByRole('button', { name: /^Continue/ }).click();
await solve(page);
await page.locator('.lesson-top .icon-btn').first().click();
await ctx.setOffline(false);

// ---------------------------------------------------------------- 4. feedback note
await page.getByRole('button', { name: 'Send feedback' }).click();
await page.getByRole('button', { name: 'confusing' }).click();
await page.locator('.sheet textarea').fill('test note');
await page.getByRole('button', { name: 'Save' }).click();
assert.equal(await page.evaluate(async () => (await new Promise((r) => { const q = indexedDB.open('vire'); q.onsuccess = () => { const c = q.result.transaction('feedback').objectStore('feedback').count(); c.onsuccess = () => r(c.result); }; }))), 1);
log('feedback note saved');

// ---------------------------------------------------------------- 5. jump ahead
await page.locator('[data-step="u3s1"]').click();
await page.getByRole('button', { name: 'Jump here (test)' }).click();
await playLesson(page);
assert.match(await page.locator('.result').innerText(), /Jump done!/);
await page.getByRole('button', { name: 'Back to the path' }).click();
assert.equal(await page.locator('[data-step="u3s1"]').getAttribute('class'), 'node current');
assert.equal(await page.locator('[data-step="u1s4"]').getAttribute('class'), 'node skipped');
log('jump to unit 3 ok');

// ---------------------------------------------------------------- 6. a whole unit (all 7 step kinds)
for (let s = 1; s <= 7; s++) {
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await playLesson(page);
  const r = await page.locator('.result').innerText();
  assert.match(r, /done!|passed!/, `u3s${s}: ${r}`);
  await page.getByRole('button', { name: 'Back to the path' }).click();
}
assert.equal(await page.locator('[data-step="u4s1"]').getAttribute('class'), 'node current');
log('unit 3: all 7 steps done through the UI');

// ---------------------------------------------------------------- 7. backup → restore on another "phone"
await page.getByRole('button', { name: 'Settings' }).click();
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save backup' }).click()]);
const backupPath = await download.path();
const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
assert.equal(backup.app, 'vire');
log(`backup: ${backup.data.cards.length} cards, ${backup.data.answers.length} answers, ${backup.data.steps.length} steps`);
const [trial] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export trial log' }).click()]);
const trialLog = JSON.parse(readFileSync(await trial.path(), 'utf8'));
assert.ok(trialLog.answers.length > 50 && trialLog.feedback.length === 1 && trialLog.sessions.length >= 1);
log('trial log exported:', trialLog.answers.length, 'answers');

const ctx2 = await browser.newContext({ ...phone });
const page2 = await ctx2.newPage();
watch(page2);
await page2.goto(URL_);
const [chooser] = await Promise.all([page2.waitForEvent('filechooser'), page2.getByRole('button', { name: 'I have a backup file' }).click()]);
await chooser.setFiles(backupPath);
await page2.locator('.path').waitFor();
assert.match(await page2.locator('.hello').innerText(), /raud/);
assert.equal(await page2.locator('[data-step="u4s1"]').getAttribute('class'), 'node current');
assert.equal(await page2.evaluate(() => window.__vire.model.cards.size), backup.data.cards.length);
log('backup restored on a second browser');
await ctx2.close();

// ---------------------------------------------------------------- 8. the rest of the path (optional, slow)
if (FULL) {
  for (let n = 0; n < 80; n++) {
    const cont = page.getByRole('button', { name: /^Continue/ }).first();
    await page.getByRole('button', { name: 'Path' }).click();
    if (!(await cont.count())) break;
    const step = await page.evaluate(() => window.__vire.model.currentStep()?.key);
    await cont.click();
    await playLesson(page);
    const r = await page.locator('.result').innerText();
    assert.match(r, /done!|passed!/, `${step}: ${r}`);
    await page.getByRole('button', { name: 'Back to the path' }).click();
  }
  assert.match(await page.locator('.hero').innerText(), /finished every unit/);
  log('FULL: every step to the checkpoint finished through the UI');
}

await ctx.close();
await browser.close();
server.close();
const real = errors.filter((e) => !/favicon/.test(e));
assert.deepEqual(real, [], 'no page errors');
console.log('E2E OK');
