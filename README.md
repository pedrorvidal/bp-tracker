# BP Tracker

[![Backend](https://github.com/pedrorvidal/bp-tracker/actions/workflows/backend.yml/badge.svg)](https://github.com/pedrorvidal/bp-tracker/actions/workflows/backend.yml)
[![Frontend](https://github.com/pedrorvidal/bp-tracker/actions/workflows/frontend.yml/badge.svg)](https://github.com/pedrorvidal/bp-tracker/actions/workflows/frontend.yml)

Personal blood pressure tracker. Monorepo:

- `backend/`: WordPress plugin (`bp-tracker`), mapped to `wp-content/plugins/bp-tracker` via `wp-env`.
- `frontend/`: Vite + React + TypeScript single-page app (not Next.js). See [`frontend/README.md`](frontend/README.md).
- `docs/`: project documentation ([`api.md`](docs/api.md), `architecture.md`).

## Requirements

- Docker (for `wp-env`)
- Node.js 22+ and npm
- PHP 8.2+ and Composer 2 (for running the backend's lint and static analysis on the host)

## Local environment

### Backend

```bash
npm install                        # installs wp-env
(cd backend && composer install)
npx wp-env start
```

This starts a dev site at `http://localhost:8888` and a test site at `http://localhost:8889`, both with the plugin active. Log in to the dev site with `admin` / `password`. See [Configuration](#configuration) for the two `wp-config.php` constants the API needs.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local         # optional; defaults to the local wp-env API
npm run dev                        # http://localhost:5173
```

The dev server must run on port `5173`, because that is the only origin the API accepts cross-origin (see [`BP_TRACKER_FRONTEND_ORIGIN`](#bp_tracker_frontend_origin)).

## Quality checks

Every change must pass these checks locally before it is merged. CI runs the same commands.

### Backend (`backend/`)

| Command                 | What it runs                                                 |
| ----------------------- | ------------------------------------------------------------ |
| `composer run lint`     | phpcs with WordPress Coding Standards (`phpcs.xml.dist`)     |
| `composer run lint:fix` | phpcbf, which auto-fixes what phpcs can                      |
| `composer run analyse`  | PHPStan level 6 with `szepeviktor/phpstan-wordpress`         |
| `composer run test`     | PHPUnit / WP-Unit; must run inside the wp-env test container |

The tests need the WordPress test library and database from `wp-env`, so run them through the `tests-cli` container:

```bash
npx wp-env run tests-cli --env-cwd=wp-content/plugins/bp-tracker composer run test
```

### Frontend (`frontend/`)

| Command                | What it runs                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `npm run lint`         | ESLint (type-aware typescript-eslint, React hooks, jsx-a11y), zero warnings allowed |
| `npm run typecheck`    | `tsc --noEmit` (strict mode)                                                        |
| `npm run format:check` | Prettier, without writing (`npm run format` fixes)                                  |
| `npm run test`         | Vitest + Testing Library (jsdom)                                                    |
| `npm run build`        | Production build into `frontend/dist/`                                              |

## Continuous integration

GitHub Actions runs on pushes to `main` and on pull requests. Each workflow only triggers when its part of the repository changes.

| Workflow                                         | Triggers on changes to                                           | Steps                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`backend.yml`](.github/workflows/backend.yml)   | `backend/**`, `.wp-env.json`, root `package*.json`, the workflow | `composer install`, lint, analyse, then tests inside `wp-env` (`tests-cli`) |
| [`frontend.yml`](.github/workflows/frontend.yml) | `frontend/**`, the workflow                                      | `npm ci`, lint, typecheck, format check, tests, build                       |

Every check in a workflow runs even when an earlier one fails, so a single run reports all problems. Any failed check fails the job.

## Configuration

The plugin's JWT authentication (`BP_Tracker_JWT_Auth`) needs two constants defined in `wp-config.php` — they are intentionally **not** stored in the database.

### `BP_TRACKER_JWT_SECRET`

Signing secret (HMAC-SHA256) for access tokens. Required — the auth endpoints return a `500` error until this is set. Generate a random 64-byte secret and add it to `wp-config.php` (above the `/* That's all, stop editing! */` line):

```bash
php -r "echo bin2hex(random_bytes(64)) . PHP_EOL;"
```

```php
define( 'BP_TRACKER_JWT_SECRET', 'paste-the-generated-value-here' );
```

Treat it like any other credential: never commit it, and rotating it immediately invalidates every access token currently in circulation (refresh tokens are unaffected, since they're validated against the database, not the JWT secret).

### `BP_TRACKER_FRONTEND_ORIGIN`

The frontend's origin: scheme, host and port, with no trailing slash. It is the only origin allowed to call the `bp-tracker/v1` REST namespace cross-origin:

```php
define( 'BP_TRACKER_FRONTEND_ORIGIN', 'http://localhost:5173' );
```

For this namespace, the plugin (`BP_Tracker_CORS`) replaces WordPress core's default CORS behavior. By default, core reflects any origin with credentials allowed. Only an exact match on scheme, host and port gets `Access-Control-Allow-*` headers, so `http://localhost:5174` or `https://localhost:5173` are rejected. Credentials are allowed for that exact origin only, so the frontend can send the `HttpOnly` refresh cookie to `/auth/*`. Other namespaces such as `wp/v2` keep core's behavior.

If the constant is left undefined, no origin is allowed. Same-origin requests and non-browser clients such as `curl` still work, but cross-origin browser requests are blocked. The frontend's dev server is pinned to port `5173` for this reason (see `frontend/vite.config.ts`).

For local development, create `.wp-env.override.json` at the repository root to set both constants for the `wp-env` dev site. The file is gitignored; never commit it. With it in place, `curl` and the frontend can call `http://localhost:8888` right away (see `docs/api.md` for examples). Then run `npx wp-env start` again.

```json
{
  "env": {
    "development": {
      "config": {
        "BP_TRACKER_JWT_SECRET": "paste-a-generated-secret-here",
        "BP_TRACKER_FRONTEND_ORIGIN": "http://localhost:5173"
      }
    }
  }
}
```

The test site doesn't need this file, because `backend/tests/bootstrap.php` defines test values. Production and staging need their own values, defined directly in `wp-config.php`.

## Authentication

See [`docs/api.md`](docs/api.md) for the full request/response reference and `curl` examples for `login`, `refresh` and `logout`.

In short:

- the refresh token lives only in an `HttpOnly; SameSite=Strict` cookie scoped to `/auth/*`, which JavaScript can't read;
- the access token lives in memory;
- the `/auth/*` routes require an `X-BP-Tracker-CSRF: 1` header.

The frontend restores the session on page load from that cookie, refreshes automatically on a `401`, and sends signed-out users to `/login`. See [`frontend/README.md`](frontend/README.md#authentication) for the details, including the requirement that the frontend and the API share a site.
