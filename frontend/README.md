# BP Tracker — frontend

Vite + React + TypeScript single-page app for the `bp-tracker` WordPress plugin's REST API (see [`docs/api.md`](../docs/api.md)).

Stack: Tailwind CSS v4 (mobile-first), TanStack Query, axios, React Router, Recharts. Tests use Vitest + Testing Library (jsdom).

## Setup

```bash
npm install
cp .env.example .env.local   # optional; defaults to the local wp-env API
npm run dev                  # http://localhost:5173
```

The dev server is pinned to port `5173` because the backend only sends CORS headers for the origin configured in `BP_TRACKER_FRONTEND_ORIGIN` (`http://localhost:5173` in local development).

## Environment

| Variable       | Default                                       |
| -------------- | --------------------------------------------- |
| `VITE_API_URL` | `http://localhost:8888/wp-json/bp-tracker/v1` |

## Scripts

| Script                 | What it does                                      |
| ---------------------- | ------------------------------------------------- |
| `npm run dev`          | Start the dev server                              |
| `npm run build`        | Type-check and build for production (`dist/`)     |
| `npm run lint`         | ESLint (typescript-eslint, React hooks, jsx-a11y) |
| `npm run typecheck`    | `tsc --noEmit` for the app and the Vite config    |
| `npm run test`         | Run the Vitest suite once                         |
| `npm run test:watch`   | Vitest in watch mode                              |
| `npm run format`       | Format with Prettier                              |
| `npm run format:check` | Check formatting without writing                  |

## Structure

```
src/
  components/  reusable UI components (one per file, PascalCase)
  pages/       route-level screens
  hooks/       custom hooks (data fetching via TanStack Query)
  context/     React context providers (e.g. auth)
  lib/         api client, token store, query client
  types/       TypeScript interfaces shared with the API (Reading, AuthTokens, …)
  test/        Vitest setup
```

## API client

`src/lib/api.ts` exports a typed axios instance whose base URL is `VITE_API_URL`. A request interceptor adds `Authorization: Bearer <access_token>` whenever `setAccessToken()` (from `src/lib/authTokens.ts`) has been given a token.

## Continuous integration

[`.github/workflows/frontend.yml`](../.github/workflows/frontend.yml) runs `npm ci`, `lint`, `typecheck`, `format:check`, `test` and `build` on every push to `main` and pull request that touches `frontend/`. Run the same scripts locally before pushing.
