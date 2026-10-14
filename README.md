# Vire

A free Russian course for the phone: a Duolingo-like path, reviews timed by FSRS, everything saved on the phone. Installable web app (PWA) that works offline.

The course design and the lesson content live in the Vire project folder (`vire/`, see its README). This folder is the app.

## Use

Open the published site on the phone and add it to the home screen (iPhone: Safari → Share → Add to Home Screen; Android: menu → Install app). Progress stays on the phone; Settings → Save backup makes a file to move it.

## Develop

```
npm ci
npm run check        # typecheck, unit tests, build, end-to-end test in a phone-sized browser
npm run dev          # build and serve on http://localhost:8080
npm run e2e:full     # plays every step of the course through the UI (slow)
```

- `src/lessons.ts` builds every exercise from the lesson JSON; `src/check.ts` checks answers (01-user-flow.md §6); `src/srs.ts` wraps ts-fsrs; `src/store.ts` is the IndexedDB storage and backup; `src/model.ts` holds the path and lesson rules; `src/ui/` is the interface (Preact).
- `content/lessons/*.json` is copied from `vire/lessons/` (written by `vire/_build/build.py`). This version includes Units 0–10 (`LAST_UNIT` in `src/content.ts`, filter in `scripts/build.mjs`).
- `content/near-forms.json` comes from `scripts/real_forms.py` and the OpenRussian dictionary data (CC BY-SA 4.0). It lists real word forms one letter away from course words, so a typo that makes another real form is never forgiven.
- Pushing to `main` runs the tests and publishes `dist/` to the `gh-pages` branch (`.github/workflows/pages.yml`).
