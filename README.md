# 💊 MediQuiz — Brand ↔ Salt Finder & MCQ Game

> **🎮 [OPEN THE APP NOW](https://github.com/jojokundesu/Mcq-game/releases/download/v1.0.0/MediQuiz.html)** — tap & it runs immediately in the browser.
> Then Chrome **⋮ → Add to Home screen → Install** for a real app icon (fullscreen, portrait, offline).
>
> 📥 Or [download the ZIP](https://github.com/jojokundesu/Mcq-game/releases/download/v1.0.0/mediquiz-standalone.zip) to keep the app forever — release page: **[v1.0.0](https://github.com/jojokundesu/Mcq-game/releases/tag/v1.0.0)**

A pharmacy app built from the shop's real stock file
(**1,690 items**, 1,421 playable medicines, 714 unique ingredient sets):

- 🔍 **Instant search** — type 2–3 letters of a *salt* ("amox clav") or a *brand* ("zerodol"); suggestions drop down immediately.
- 📋 **Full info cards** — tap any brand → ingredients, form, strength, usual dose, clinical note, sale rate (₹), data-source badge, category; plus chips of every other brand with the same composition.
- 🧂 **Salt browser** — browse all 714 ingredient families and every brand inside them.
- 🎯 **Two game modes** —
  - **Brand → Salts**: pick the composition of the shown brand.
  - **Salts → Brand**: pick the brand matching the shown ingredients. **Distractors are guaranteed to have different ingredient sets — exactly one option can ever match** (verified: 4,000/4,000 generated questions clean).
- ✨ Every answer reveals the correct result + optionally the full card; score with streaks, time bonus, 50:50 lifelines, personal bests, share-score, confetti, sounds & haptics.
- 📴 **Works offline** (PWA + service worker), portrait-only layout.

## Run it

```bash
cd Mcq-game
npm install          # express + compression only, no build step
npm start            # → http://localhost:8080
```

## Install on the phone (Realme 9i / any Android)

1. Open the app URL in **Chrome** on the phone (same Wi-Fi, or the hosted URL).
2. Tap **⋮ menu → Add to Home screen → Install**.
3. It launches fullscreen, **portrait-locked**, with the app icon — and keeps working fully offline after the first visit.

### Optional: build an APK (Play-store style)

The app is a fully PWA-compliant site, so a signed APK can be produced automatically:

1. Host the app at a public HTTPS URL.
2. Go to **pwabuilder.com** → enter the URL → *Package for Android* → download the generated APK/AAB.
3. Sideload the APK on the phone (or publish to Play Store).

## Data provenance & verification

`data/medicines.json` is generated from
`Stock_Medicines_Subcategorized_by_Ingredient.docx` by `scripts/build_dataset.py`.

- **93 brands** whose ingredient cells were blank in the file were **verified against reliable web sources** (1mg, PharmEasy, Apollo, MedPlusMart, manufacturer sites) and filled — tagged *✔ web-verified* in the UI.
- **~15 devices/consumables** (syringes, catheters, test cards, instruments) reclassified as *non-drug* (searchable, but excluded from the game).
- **91 items** could not be verified from a reliable source and were **skipped entirely** (not guessed). Full list: `data/skipped_report.json` and the app's **More → Medicines skipped** panel.

## Stack

Express + Compression · vanilla HTML/CSS/JS SPA · PWA (manifest + service worker) · WebAudio synth sounds · localStorage stats. Backend also exposes an **anti-guessing quiz API** (`POST /api/quiz`, `POST /api/quiz/:sid/answer`) which generates questions server-side with the same uniqueness guarantees; the client mirrors the generator offline.
