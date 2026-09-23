# BP Tracker

Personal blood pressure tracker. Monorepo:

- `backend/` — WordPress plugin (`bp-tracker`), mapped to `wp-content/plugins/bp-tracker` via `wp-env`.
- `frontend/` — Vite + React + TypeScript single-page app (not Next.js).
- `docs/` — project documentation (`architecture.md`, `api.md`).

## Local environment

```bash
npm install
npx wp-env start
```

This starts a dev site (`http://localhost:8888`) and a test site (`http://localhost:8889`), both with the plugin active. See `backend/composer.json` for the `lint`/`analyse`/`test` scripts.

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

For this namespace, the plugin (`BP_Tracker_CORS`) replaces WordPress core's default CORS behavior. By default, core reflects any origin with credentials allowed. Only an exact match on scheme, host and port gets `Access-Control-Allow-*` headers, so `http://localhost:5174` or `https://localhost:5173` are rejected. Credentials (cookies) are never allowed, because the API authenticates with Bearer tokens. Other namespaces such as `wp/v2` keep core's behavior.

If the constant is left undefined, no origin is allowed. Same-origin requests and non-browser clients such as `curl` still work, but cross-origin browser requests are blocked. The frontend's dev server is pinned to port `5173` for this reason (see `frontend/vite.config.ts`).

For local development, `.wp-env.override.json` (gitignored, never commit it) sets both constants for the `wp-env` dev site so `curl`/the frontend can hit `http://localhost:8888` right away — see `docs/api.md` for examples. Production/staging still need their own values defined directly in `wp-config.php`.

## Authentication

See [`docs/api.md`](docs/api.md) for the full request/response reference and `curl` examples for `login`, `refresh` and `logout`.
