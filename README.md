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

## Deploy
Every push to `main` runs the full test suite and, if green, deploys to GitHub Pages:
**https://pasuay.github.io/tonic/** (`.github/workflows/ci.yml` — tests gate the deploy).
Netlify remains an option for private-repo hosting: `netlify.toml` is configured
(Add new site → Import an existing project → pick this repo).

## Architecture
- `js/theory.js` — pure music theory (degrees, cadences, K-S key-clarity gate, generators)
- `js/audio.js` — synthesis, scheduling, `completionAudio()` (single owner of round-end sound), mic + pitch detection
- `js/machine.js` — round lifecycle; generation tokens orphan every stale callback
- `js/stats.js` — stats, XP, mastery, confusion, persistence, daily streaks
- `js/ui.js` — DOM rendering only, spec-driven
- `js/main.js` — composition root
