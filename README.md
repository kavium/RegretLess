# QOL IB Questionbank

Static Vite app for building mixed-unit IB practice sets with:

- subject picker backed by published JSON bundles
- mixed umbrella + subunit selection with normalization
- paper and level filters
- completed and difficult persistence in the browser
- resume-from-last-session modal
- maintainer-side ingest pipeline for refreshing published data

## Commands

```bash
npm install
npm run sample-data
npm run dev
```

Useful scripts:

```bash
npm run test:run
npm run build
npm run ingest
```

`npm run sample-data` crawls a bounded starter dataset. `npm run ingest` uses the same pipeline without the sample limit.

## Data pipeline

- `scripts/ingest-questionbank.mjs` discovers subjects, crawls syllabus trees, fetches section pages, and normalizes question pages.
- Output goes to `public/data/manifest.json` and `public/data/subjects/*.json`.
- The app caches those published bundles in IndexedDB and keeps user state in localStorage.

## Deployment

- Vercel hosts the site and should be connected to this repo for automatic production deploys from `main` plus preview deploys for pull requests.
- Set `VITE_DATA_BASE_URL` in Vercel to `https://cdn.statically.io/gh/<owner>/<repo>@data` so production reads the published JSON bundles from the GitHub-backed `data` branch.
- `.github/workflows/ci.yml` runs repository checks only; it does not deploy the site.
- `.github/workflows/scrape.yml` refreshes published question data on schedule or manual dispatch and pushes updates to the `data` branch.
- `VITE_BASE` is not needed for Vercel production hosting.
