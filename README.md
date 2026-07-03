# Tonic — relative pitch trainer

You already play it by ear. Now name what you hear.
Ear training for pop musicians & producers — not the conservatory.

## Run locally
Open `index.html` via any static server (ES modules need http/https):
```
npx serve .
```

## Tests
```
npm ci
npm run test        # logic parity suite (theory, stats, generators)
npm run test:ui     # interaction smoke tests (jsdom; ~30s, real round flows)
npm run test:all
```

## Deploy (one-time setup)
1. Create an empty GitHub repo, then from this folder:
   `git remote add origin <your-repo-url> && git push -u origin main`
2. GitHub Actions runs the full test suite on every push (`.github/workflows/test.yml`).
3. On https://app.netlify.com: **Add new site → Import an existing project** → pick the repo.
   `netlify.toml` is already configured (static publish, no build step).
Every push now tests and deploys automatically. Mic requires the https URL Netlify provides.

## Architecture
- `js/theory.js` — pure music theory (degrees, cadences, K-S key-clarity gate, generators)
- `js/audio.js` — synthesis, scheduling, `completionAudio()` (single owner of round-end sound), mic + pitch detection
- `js/machine.js` — round lifecycle; generation tokens orphan every stale callback
- `js/stats.js` — stats, XP, mastery, confusion, persistence, daily streaks
- `js/ui.js` — DOM rendering only, spec-driven
- `js/main.js` — composition root
