# RegretLess

A free, no-login IB Questionbank alternative built for students preparing for IB Diploma exams. RegretLess covers more than 95% of the questions available in the official IB Questionbank and is designed around the practice workflow that the official tool fails to provide.

**Live site:** https://regretless-ib.vercel.app/
**Alternative site:** https://kavium.github.io/RegretLess/

## Why this exists

The official IB Questionbank displays each question alongside its markscheme, with no way to defer the answer, no way to randomize question order, and no way to track progress across a study session. Practising under those conditions encourages passive reading rather than genuine attempts. RegretLess was built to fix that core problem and a number of related quality-of-life gaps that surfaced during development.

## Features

- **Hidden markschemes by default.** Each question is displayed alone. The markscheme is revealed only on explicit request, after an attempt has been made.
- **Paper filtering.** Questions can be filtered by paper (1A, 1B, 2, etc.) to support targeted drilling of specific paper formats.
- **Question scrambling.** Question order can be randomized on demand, preventing positional memorization across repeated practice sessions.
- **Completion tracking.** Questions marked as completed sink to the bottom of the list on the next scramble or page refresh, surfacing unattempted material first.
- **Difficulty flagging and filtering.** Questions can be marked as difficult and a single toggle filters the list down to the difficult set, enabling focused review of weak areas before exams.
- **Local-only state.** Progress is persisted in the browser via IndexedDB and localStorage. No accounts, no servers, no tracking.
- **Subject coverage.** More than 95% of questions from the official IB Questionbank are ingested across supported subjects.

## Tech stack

- Vite + React + TypeScript
- React Router (HashRouter) for client-side routing
- TanStack Virtual for windowed question lists
- IndexedDB for cached subject bundles, localStorage for user state
- A maintainer-side ingest pipeline that crawls the official questionbank and publishes normalized JSON bundles

## Project status and contributions

RegretLess is maintained by a single contributor and provided free of charge. Bug reports, missing-question reports, and feature requests are welcome through the GitHub issue tracker. Pull requests are accepted for clearly scoped fixes; larger changes should be discussed in an issue first.

## Notes on content

Question content is sourced from publicly accessible material on the official IB Questionbank and is reproduced here for educational use by IB students preparing for the IB Diploma exams.
