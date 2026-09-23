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

| Script                 | What it does                                                             |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm run dev`          | Start the dev server                                                     |
| `npm run build`        | Type-check and build for production (`dist/`)                            |
| `npm run lint`         | ESLint (typescript-eslint, React hooks, jsx-a11y), zero warnings allowed |
| `npm run typecheck`    | `tsc --noEmit` for the app and the Vite config                           |
| `npm run test`         | Run the Vitest suite once                                                |
| `npm run test:watch`   | Vitest in watch mode                                                     |
| `npm run format`       | Format with Prettier                                                     |
| `npm run format:check` | Check formatting without writing                                         |

## Structure

```
src/
  components/  reusable UI components (one per file, PascalCase)
  pages/       route-level screens
  hooks/       custom hooks (data fetching via TanStack Query)
  context/     React context providers (AuthProvider)
  lib/         api client + interceptors, auth store and calls, query client
  types/       TypeScript interfaces shared with the API (Reading, AuthTokens, …)
  test/        Vitest setup, API mock adapter, fixtures, render helpers
```

## Authentication

Authentication follows the backend's access and refresh token model (see [`docs/api.md`](../docs/api.md#authentication-bp-trackerv1auth)).

| Piece                               | Role                                                                                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/authStore.ts`              | Single source of truth for the session (`AuthSession`: tokens + user). Kept in memory and mirrored to `localStorage` under `bp-tracker.auth`, so a reload keeps the user signed in. |
| `src/lib/api.ts`                    | Typed axios client (`VITE_API_URL`) plus the interceptors described below.                                                                                                          |
| `src/lib/authApi.ts`                | `login()` and `logout()` calls to the API.                                                                                                                                          |
| `src/context/AuthContext.tsx`       | `AuthProvider`, which reads the store with `useSyncExternalStore` and exposes `user`, `isAuthenticated`, `login()` and `logout()`.                                                  |
| `src/hooks/useAuth.ts`              | `useAuth()`, the hook for reading the context.                                                                                                                                      |
| `src/components/ProtectedRoute.tsx` | Redirects to `/login` when signed out, remembering the requested page. Works as a layout route (`<Outlet />`) or as a wrapper.                                                      |
| `src/pages/Login.tsx`               | Sign-in form. Invalid credentials show "Invalid username or password."; after signing in, the user returns to the page they requested.                                              |

### Request flow

1. **Bearer header.** Every request gets `Authorization: Bearer <access token>` when signed in, except `/auth/login` and `/auth/refresh`. The backend rejects any request that carries an expired Bearer header, so sending it there would make it impossible to sign in or refresh with a stale token.
2. **Automatic refresh.** On a `401`, the client calls `POST /auth/refresh` with the stored refresh token and retries the request once with the new access token. Refresh tokens are single-use, so concurrent 401s share one refresh request instead of racing.
3. **Failed refresh.** If the server rejects the refresh token, the session is cleared. `AuthProvider` re-renders and `ProtectedRoute` sends the user to `/login`. A network failure during refresh keeps the session, so a flaky connection doesn't sign anyone out.
4. **Logout.** Logout revokes the refresh token with `POST /auth/logout`. If the access token has expired, it refreshes first and revokes the new refresh token. The local session and the TanStack Query cache are always cleared, even when the server can't be reached.

### Token storage

Both tokens are stored in `localStorage` so the session survives a reload. Any script running on the page can read them, so an XSS flaw would expose them. Mitigations:

- the access token is short-lived (1 hour);
- refresh tokens are single-use and revoked on logout;
- React escapes rendered output by default, so don't use `dangerouslySetInnerHTML` with untrusted data.

Moving the refresh token to an `HttpOnly` cookie would remove this exposure, but it needs backend support.

## Continuous integration

[`.github/workflows/frontend.yml`](../.github/workflows/frontend.yml) runs `npm ci`, `lint`, `typecheck`, `format:check`, `test` and `build` on every push to `main` and pull request that touches `frontend/`. Run the same scripts locally before pushing.
