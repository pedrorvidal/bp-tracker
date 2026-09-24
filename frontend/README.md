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
  lib/         api client + interceptors, auth store and calls, query client,
               date helpers, reading form validation
  types/       TypeScript interfaces shared with the API (Reading, AuthTokens, …)
  test/        Vitest setup, API mock adapter, fixtures, render helpers
```

## Routes and navigation

| Path       | Page                   | Access                                                     |
| ---------- | ---------------------- | ---------------------------------------------------------- |
| `/login`   | `pages/Login.tsx`      | Public; redirects signed-in users to where they were going |
| `/new`     | `pages/NewReading.tsx` | Signed in                                                  |
| `/history` | `pages/History.tsx`    | Signed in                                                  |
| `/account` | `pages/Account.tsx`    | Signed in; includes "Sign out of all devices"              |
| `/`        | redirects to `/new`    | There is no dashboard yet                                  |

Any other path redirects to `/`.

`components/MainNav.tsx` links New reading, History and Account. On mobile it is a bar fixed to the bottom of the screen, within thumb reach, and `main` gets bottom padding so content isn't hidden behind it. From `md` up it sits in the header. "Sign out" stays in the header at every size.

## Readings

### Hooks (`src/hooks/useReadings.ts`)

| Hook                             | Request                     | Returns                                                                                                            |
| -------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `useReadings(query?)`            | `GET /readings`             | `{ readings, total, totalPages }`; the totals come from the `X-WP-Total*` headers                                  |
| `useCreateReading()`             | `POST /readings`            | The created `Reading`. On success, every readings query is invalidated.                                            |
| `useAllReadings(period?)`        | `GET /readings`, every page | Every reading in the period (or lifetime), newest first (100 per page; remaining pages fetched in parallel)        |
| `useStats(period?, { enabled })` | `GET /stats`                | `ReadingStats` for the period (averages, min/max, count); no period = lifetime; `enabled: false` skips the request |
| `useDeleteReading()`             | `DELETE /readings/{id}`     | On success, readings and stats queries are invalidated                                                             |

Query keys come from `readingsKeys` (`['readings', ...]`). Signing out clears the whole query cache.

### New reading form (`src/pages/NewReading.tsx`)

- **Mobile first:** fields are at least 48px tall with 18px text. Systolic/diastolic and pulse/weight sit side by side because they are short numbers. Numeric fields use `inputmode` to open the number keypad on phones.
- **Validation before sending** (`src/lib/readingForm.ts`), with the same limits as the backend:
  - systolic 60–250 and diastolic 40–150, both required;
  - pulse 30–220, optional;
  - weight, optional, a positive number (`72.5` or `72,5`);
  - systolic must be higher than diastolic, which catches swapped values.

  Invalid values never reach the API.

- **Accessible errors:** each error and hint is linked to its input through `aria-describedby`, and invalid inputs get `aria-invalid`. Focus moves to the first invalid field. If the API rejects a field (`400 rest_invalid_param`), the error is shown on that field.
- **After saving:** the form resets, with the date back to "now", and a confirmation appears in a `role="status"` region, so screen readers announce it.

### History page (`src/pages/History.tsx`)

The layout is mobile-first: one stacked column with no breakpoint prefix, and `lg:`/`xl:` only enhance larger screens. Pages share a `max-w-7xl` container, and each page sets its own content width (the form and login stay narrow). From `lg` up, the title and the period selector share a row, the summary is a row of four cards, and the chart grows from 320px to 480px tall.

The selected period lives in `History` as a `DateRange` (`lib/dateRange.ts`): whole local days, both ends inclusive, as `YYYY-MM-DD`, with `{ start: null, end: null }` meaning lifetime. `rangeToParams()` turns it into `period_start`/`period_end`, from midnight of the first day to 23:59:59 of the last, with the local offset. Lifetime sends no params. The period is part of every query key, so changing it refetches.

- **`PeriodSelector`:**
  - a segmented control with presets for 7, 10, 30 and 90 days and Lifetime, as toggle buttons with `aria-pressed`;
  - **Custom**, with two native `<input type="date">` fields, capped at today, and an accessible error when the start is after the end;
  - it emits `{ start, end }` only when the range is valid.
- **`SummaryCard`**, four mini-cards (`StatCard`) in `grid-cols-2 lg:grid-cols-4`:
  - **Avg systolic, diastolic and pulse:** a `text-3xl font-bold tabular-nums` value, min/max, and the change against the **previous period of the same length**, in words.
  - **Change colors:** for blood pressure a drop is green and a rise is red; pulse and "no change" stay neutral. The comparison is omitted, keeping the layout, when the previous period has fewer than 3 readings, for a measure missing from either period, and for lifetime.
  - **Readings:** the count plus the **category distribution**: a proportional bar (decorative) and pills such as "18 Normal · 3 Elevated · 1 Stage 1". The categories are computed from the same cached readings query as the list, with no extra request.
- **`ReadingsChart`:** one `LineChart` on a shared mmHg axis.
  - **Lines:** systolic in red and diastolic in blue, with dots up to 31 points.
  - **X axis:** categorical, one position per reading, so time gaps aren't to scale. The list below has the exact dates.
  - **Normal limits:** dashed `ReferenceLine`s at 120 (systolic) and 80 (diastolic). They are labelled in the right margin, outside the plot so they never cover data: the full text on `lg`, just the value on phones.
  - **Tooltip:** date and time, the reading as `133/85 mmHg`, pulse, and the reading's **category** with its color dot (`classify()` in `lib/bpCategory.ts`).
  - **No category bands:** the categories use different thresholds for systolic and diastolic, so bands on a shared axis would be wrong.
  - **Zoom:** a `Brush` zooms and pans.
  - **Auto-aggregation:** above 100 readings the chart plots **daily averages**, with a **Show every reading** toggle.
  - **Legend:** chips for the two lines and the normal limits.
- **List:** cards on mobile and a table from `md` up, full width, with delete and confirmation.

Categories follow the 2017 ACC/AHA guideline, where a reading takes the more severe of its systolic and diastolic categories. They are shown for reference, not as a diagnosis.

### Dark mode

The app follows the OS setting (`prefers-color-scheme`) through Tailwind's `dark:` variants. There is no manual toggle.

- **Colors:** every surface, text and border color has a `dark:` counterpart. `src/test/darkModeCoverage.test.ts` fails the build if a component adds a light color without one, which would otherwise make text unreadable on the dark background.
- **Native controls:** `color-scheme: light dark` makes date pickers and scrollbars follow the theme too.
- **Charts:** Recharts takes colors as props, not classes, so the chart reads the scheme with `usePrefersDark()` (built on `useMediaQuery()`) and switches to the dark steps of the same validated palette (`components/chartSeries.ts`).
- **Transitions:** buttons and links animate their hover colors (`transition-colors duration-200`).

### Dates

`<input type="datetime-local">` works in local time with no offset. Readings are sent as ISO 8601 **with the device's UTC offset**, for example `2026-09-23T07:45:00-03:00`, so the wall-clock time the user entered is kept (`src/lib/datetime.ts`). The tests run in `America/Sao_Paulo` (set in `vite.config.ts`), so the offset handling is exercised with a real non-zero offset.

## Authentication

Authentication follows the backend's access and refresh token model (see [`docs/api.md`](../docs/api.md#authentication-bp-trackerv1auth)).

### Where the tokens live

| Token                   | Stored in                                                                     | Readable by JavaScript?    |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------- |
| Refresh token (30 days) | `HttpOnly; SameSite=Strict` cookie set by the backend, sent only to `/auth/*` | **No**                     |
| Access token (15 min)   | Memory only (`src/lib/authStore.ts`)                                          | Yes, while the tab is open |

Nothing auth-related is written to `localStorage` or `sessionStorage`. Tokens stored there by earlier versions are deleted on load. An XSS flaw could use the access token while the tab is open, but it can't steal a long-lived credential: the refresh token never reaches JavaScript.

### Pieces

| File                                   | Role                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/authStore.ts`                 | In-memory session (`AuthSession`: access token + user) and its `status` (`loading`, `authenticated`, `unauthenticated`).                                                                                                                                                                                                       |
| `src/lib/api.ts`                       | Typed axios client (`VITE_API_URL`), the request and response interceptors, `refreshSession()` and `initializeSession()`.                                                                                                                                                                                                      |
| `src/lib/authApi.ts`                   | `login()` and `logout()`, and cross-tab logout via `BroadcastChannel`.                                                                                                                                                                                                                                                         |
| `src/context/AuthContext.tsx`          | `AuthProvider`: restores the session on mount and exposes `status`, `user`, `isAuthenticated`, `login()` and `logout()`.                                                                                                                                                                                                       |
| `src/hooks/useAuth.ts`                 | `useAuth()`, the hook for reading the context.                                                                                                                                                                                                                                                                                 |
| `src/components/ProtectedRoute.tsx`    | Shows a loading state while the session is being restored, then either renders the page or redirects to `/login`, remembering the requested page.                                                                                                                                                                              |
| `src/pages/Login.tsx`                  | Sign-in form. Invalid credentials show "Invalid username or password."; an account awaiting approval (`bp_tracker_jwt_account_pending`) shows "Your account is pending approval…"; a lockout (`429`) shows "Too many failed attempts. Try again in N minutes.". After signing in, the user returns to the page they requested. |
| `src/components/SignOutEverywhere.tsx` | "Sign out of all devices" on the home page. On a network or server error it keeps the session and shows an error, so the user knows the other devices may still be signed in.                                                                                                                                                  |

### Flow

1. **Page load.** The access token only lives in memory, so after a reload `AuthProvider` calls `POST /auth/refresh`. The browser sends the cookie; the app never touches it. Protected pages show "Loading…" until the call returns.
2. **Requests.** Data routes get `Authorization: Bearer <access token>`. `/auth/*` routes instead get `withCredentials: true`, which sends the cookie, and the `X-BP-Tracker-CSRF: 1` header, and never a Bearer token (the backend rejects a stale one).
3. **Automatic refresh.** On a `401`, the client refreshes once and retries the request. Refresh tokens are single-use and every tab shares the cookie, so refreshes are serialized: within a tab, concurrent 401s share one request, and across tabs a Web Lock (`navigator.locks`) makes each tab wait for the previous refresh. Without the lock, two tabs refreshing at the same moment would sign one of them out.
4. **Failed refresh.** If the server rejects the refresh, the session is cleared and `ProtectedRoute` sends the user to `/login`. A network failure keeps the current session, so a flaky connection doesn't sign anyone out.
5. **Logout.** `POST /auth/logout` revokes the cookie's token and clears the cookie. The local session and the TanStack Query cache are always cleared, even when the server can't be reached, and every other open tab signs out too (via `BroadcastChannel`).
6. **Sign out of all devices.** `POST /auth/logout-all` revokes every session of the user on the server, including access tokens that haven't expired yet, and then ends this one the same way as logout. It never fakes success: if the server can't be reached, the session is kept and an error is shown.

### Deployment requirement

`SameSite=Strict` cookies are only sent when the frontend and the API are the **same site**, meaning the same scheme and registrable domain; the port doesn't matter. For example, `app.example.com` and `api.example.com` work, and so do `localhost:5173` and `localhost:8888`. Serving the frontend and the API from unrelated domains would break refresh.

## Continuous integration

[`.github/workflows/frontend.yml`](../.github/workflows/frontend.yml) runs `npm ci`, `lint`, `typecheck`, `format:check`, `test` and `build` on every push to `main` and pull request that touches `frontend/`. Run the same scripts locally before pushing.
