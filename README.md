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
cp backend/.env.example backend/.env
# set BP_TRACKER_JWT_SECRET in backend/.env (openssl rand -base64 48)
npx wp-env start
```

This starts a dev site at `http://localhost:8888` and a test site at `http://localhost:8889`, both with the plugin active. Log in to the dev site with `admin` / `password`. Before the first start, create `backend/.env` (see [Configuration](#configuration)); without it, plugin activation fails.

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

The plugin needs two settings. They are **not** stored in the database, and neither is committed to the repository.

| Setting                      | Required               | Purpose                                              |
| ---------------------------- | ---------------------- | ---------------------------------------------------- |
| `BP_TRACKER_JWT_SECRET`      | Yes, at least 32 bytes | HMAC-SHA256 key that signs access tokens             |
| `BP_TRACKER_FRONTEND_ORIGIN` | No                     | The only origin allowed to call the API cross-origin |

### Local development: `backend/.env`

```bash
cp backend/.env.example backend/.env
openssl rand -base64 48     # paste the output as BP_TRACKER_JWT_SECRET
```

```dotenv
BP_TRACKER_JWT_SECRET=<the generated value>
BP_TRACKER_FRONTEND_ORIGIN=http://localhost:5173   # the Vite dev server
```

Create the file **before** `npx wp-env start`, because wp-env activates the plugin and activation needs the secret. `backend/.env` is gitignored; only `backend/.env.example`, which has placeholders, is committed. Changes take effect on the next PHP request, with no need to restart wp-env.

`backend/bp-tracker.php` loads the file with [vlucas/phpdotenv](https://github.com/vlucas/phpdotenv) (`Dotenv::createImmutable(...)->safeLoad()`). Each setting is resolved in this order, and the first one found wins:

1. **A constant already defined**, e.g. in `wp-config.php`. It is never overridden.
2. **A real environment variable** of the PHP process, e.g. set by Docker or CI.
3. **`backend/.env`**.

Values from the file go into `$_ENV` only, never into `putenv()`, so they don't leak into the environment of processes PHP starts.

### Production and staging

Define the constants in `wp-config.php`, above the `/* That's all, stop editing! */` line, or set them as real environment variables. A `backend/.env` file works too, but only if the web server refuses to serve it (see below).

```php
define( 'BP_TRACKER_JWT_SECRET', 'output of: openssl rand -base64 48' );
define( 'BP_TRACKER_FRONTEND_ORIGIN', 'https://app.example.com' );
```

### Safeguards

- **Activation fails** with a clear message if `BP_TRACKER_JWT_SECRET` is missing or shorter than 32 bytes, so the plugin never runs without a usable secret. If the secret disappears after activation, the auth endpoints return `500 bp_tracker_jwt_misconfigured`.
- **`backend/.env` is inside the plugin directory, which is web-accessible.** `backend/.htaccess` blocks every dotfile on Apache, including wp-env. Without it, `/wp-content/plugins/bp-tracker/.env` would be downloadable. **On nginx `.htaccess` is ignored**, so add `location ~ /\. { deny all; }` to the server block.
- **Rotating the secret** immediately invalidates every access token in circulation. Refresh tokens are unaffected, because they are validated against the database, not the secret. Clients simply refresh.

### `BP_TRACKER_FRONTEND_ORIGIN` and CORS

The origin must be exact: scheme, host and port, with no trailing slash. For the `bp-tracker/v1` namespace, the plugin (`BP_Tracker_CORS`) replaces WordPress core's default CORS behavior, which reflects any origin with credentials allowed:

- Only an exact match gets `Access-Control-Allow-*` headers. `http://localhost:5174` and `https://localhost:5173` are rejected.
- Credentials are allowed for that exact origin only, so the frontend can send the `HttpOnly` refresh cookie to `/auth/*`.
- Other namespaces, such as `wp/v2`, keep core's behavior.

If the setting is left undefined, no origin is allowed. Same-origin requests and non-browser clients such as `curl` still work, but cross-origin browser requests are blocked. This is why the frontend's dev server is pinned to port `5173` (see `frontend/vite.config.ts`).

The test site needs no `.env`: `backend/tests/bootstrap.php` defines test values before the plugin loads. CI creates a throwaway `backend/.env` only so that wp-env can activate the plugin.

## Authentication

See [`docs/api.md`](docs/api.md) for the full request/response reference and `curl` examples for `register`, `login`, `refresh`, `logout` and `logout-all`.

In short:

- the refresh token lives only in an `HttpOnly; SameSite=Strict` cookie scoped to `/auth/*`, which JavaScript can't read;
- the access token lives in memory and expires after 15 minutes;
- the `/auth/*` routes require an `X-BP-Tracker-CSRF: 1` header;
- failed logins are rate limited, per account + IP, per IP and per account, and the response is `429` with a wait time;
- changing the password, or "sign out of all devices" (`POST /auth/logout-all`), revokes every session of the user immediately;
- reusing a refresh token that was already used (a sign of theft) revokes that whole session, including the thief's copy;
- expired refresh tokens are purged daily by WP-Cron.

### Accounts and approval

- `POST /auth/register` creates an account with the `bp_tracker_pending` role. It has no capabilities and can't log in (`403`, "Your account is pending approval.").
- An administrator approves it by changing the role to `bp_tracker_user`, on the Users screen or with `npx wp-env run cli wp user set-role <user> bp_tracker_user`.
- `bp_tracker_user` can create, edit and delete **only their own** readings. No role has `edit_others_bp_readings` or `delete_others_bp_readings`.
- Readings use their own capabilities (`edit_bp_readings`, …), so generic roles such as `author` or `subscriber` get `403` on every readings route. Existing users need the `bp_tracker_user` role.
- Making a user pending again revokes all of their sessions.
- App users never use WordPress directly: wp-admin and the native login redirect them to the app, and REST routes outside `bp-tracker/v1` return `403`. Administrators are never restricted.

Details are in [`docs/api.md`](docs/api.md#roles-and-approval) and [`docs/architecture.md`](docs/architecture.md#user-roles-and-approval-flow).

The frontend restores the session on page load from that cookie, refreshes automatically on a `401`, and sends signed-out users to `/login`. See [`frontend/README.md`](frontend/README.md#authentication) for the details, including the requirement that the frontend and the API share a site.
