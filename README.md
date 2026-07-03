# Tonic.

**You already play it by ear. Now name what you hear.**
Ear training for pop musicians & producers — not the conservatory.

### ▶ [Use it now — pasuay.github.io/tonic](https://pasuay.github.io/tonic/)
Free, no signup. Runs in the browser; progress saves locally on your device. Use headphones; allow the mic for Sing-back mode.

![Tonic — functional ear training](assets/screenshot.png)

## What it does
You can already replay melodies and chords by ear — what's missing is the ability to instantly **name** what you hear. Tonic trains that link: a short chord progression establishes the key, a note (or phrase) plays, and you name its scale degree in movable-do solfège. That's *functional* ear training — hearing each note by its role in the key, the way pop musicians actually use their ears.

- **7 stages**, simplest first: three anchor tones → the full major scale → random keys → 2/3/4-note phrases → *Find do*, where no key is given and you infer the tonic yourself
- **Sing-back mode**: the app names a degree, you sing it — a live needle checks your pitch (any octave)
- **Pop-shaped**: I–V–vi–IV and friends, minor keys (la-based), five instrument sounds
- **Adaptive**: weak degrees appear more often; recurring confusions trigger short pair drills
- **Melodies are guaranteed fair**: every *Find do* melody passes a Krumhansl–Schmuckler key-clarity gate before it's served
- Daily goal, streaks, XP — enough game to keep you honest, not enough to distract

The method (cadence-context, resolve-to-tonic, staged difficulty) and its references live in the app's *Why this works* panel.

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
