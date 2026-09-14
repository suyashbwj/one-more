# Verification — September 14, 2026

- `npm test`: 14 passing tests. Covers idempotent replay, conflicting keys, identical intentional sets, stale corrections, completed-session protection, invalid input rollback, bodyweight sets, persistence across database reopen, ambiguous corrections, exercise-specific targeting, overlapping exercise names, malformed commands, negative/fractional/conflicting quantities, and safe empty-session discard.
- `npm run build`: TypeScript and Vite production build pass. Vite reports a bundle-size advisory because the voice SDK is included in the entry bundle.
- Desktop browser: start workout, log two 135 lb × 8 sets, propose and confirm set 2 → 7 reps, reload and verify persisted values.
- Phone viewport, 390 × 844: verified horizontal exercise scrolling without page overflow, manually corrected set 1 → 10 reps, completed the session, and verified History and Progress show 2 sets and 2,295 lb total volume.
- Verified the unconfigured voice button shows actionable setup instructions rather than a simulated conversation.
- Archived browser-only test data outside the deliverable and left the real journal empty.
- Production build is served on port 4317. Database and tests use SQLite.

## September 14 visual redesign

- Production TypeScript/Vite build passes after the redesign.
- Visually inspected desktop and 390 × 844 phone layouts; also checked history and preferences at 320 × 740. No horizontal page overflow in checked phone views.
- On an isolated database, started a session, logged 135 lb × 8, corrected it to 10 reps, reloaded, and finished the workout. The archive showed one set and 1,350 lb volume.
- Checked phone navigation between Workout, History, and Progress. The user's journal remains empty; redesign QA uses a separate database outside the deliverable.
- Reference sites and implemented visual principles are recorded in `design-notes.md`.

Not yet verified: a credentialed ElevenLabs conversation, real microphone audio, gym-noise recognition, physical iOS/Android devices, or HTTPS phone voice access. The voice provider's quota and billing were not exercised.

## Local training tools

- `npm test`: 19 passing tests, including legacy database migration, persistent notes, idempotent note saving, stale note rejection, sample fixture compatibility, mixed-unit trends, bodyweight reps, sample exclusion, and archive search.
- TypeScript and Vite production build pass. The existing voice-SDK bundle advisory remains.
- Isolated browser journal: reused 135 lb × 10 from the previous workout, logged it, recovered an unsaved note after reload, saved the note, finished the workout, and found it by searching the note text. Expanded history displayed the saved notes state.
- Exercise trend selector displayed total reps and heaviest set for the two completed test sessions. Inspected desktop layout at 1280 px and the narrow phone layout at 354 px; the narrow view had no horizontal page overflow.
- Real journal data was not populated with test workouts. QA used `work/redesign-qa.sqlite` on port 4318.
