# API

REST endpoints exposed by the `bp-tracker` plugin. Base URL in local dev: `http://localhost:8888/wp-json`.

## Authentication (`bp-tracker/v1/auth`)

First-party JWT auth (`backend/includes/class-bp-tracker-jwt-auth.php`) — no third-party plugin. Access tokens are short-lived JWTs (1h); refresh tokens are long-lived (30 days), opaque, single-use (rotated on every refresh) and revocable, since a bare JWT can't be invalidated on its own.

Send the access token on subsequent requests as `Authorization: Bearer <access_token>`. This also authenticates any other REST route the current user can access (e.g. `wp/v2/bp-readings`), not just the `bp-tracker/v1` namespace.

### `POST /bp-tracker/v1/auth/login`

Body: `username`, `password` (validated via `wp_authenticate()`).

```bash
curl -s -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'
```

Success (`200`):

```json
{
  "access_token": "eyJ...",
  "refresh_token": "9f2c...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

Invalid credentials → `403`.

### `POST /bp-tracker/v1/auth/refresh`

Body: `refresh_token`. On success the old refresh token is deleted and a new pair is returned (rotation) — reusing the old token afterwards fails.

```bash
curl -s -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"9f2c..."}'
```

Invalid, expired or already-used refresh token → `401`.

### `POST /bp-tracker/v1/auth/logout`

Authenticated (send `Authorization: Bearer <access_token>`). Body: `refresh_token` to revoke.

```bash
curl -s -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/logout \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"9f2c..."}'
```

No/invalid access token → `401`. Success → `200`, `{"success": true}`.

### End-to-end example

```bash
# 1. Log in, keep both tokens
resp=$(curl -s -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}')
access_token=$(echo "$resp" | jq -r .access_token)
refresh_token=$(echo "$resp" | jq -r .refresh_token)

# 2. Call a protected endpoint
curl -s http://localhost:8888/wp-json/wp/v2/bp-readings \
  -H "Authorization: Bearer $access_token"

# 3. Refresh once the access token is close to expiring
resp=$(curl -s -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$refresh_token\"}")
access_token=$(echo "$resp" | jq -r .access_token)
refresh_token=$(echo "$resp" | jq -r .refresh_token)

# 4. Log out (revokes the refresh token)
curl -s -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/logout \
  -H "Authorization: Bearer $access_token" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$refresh_token\"}"
```

## `bp_reading` (`wp/v2/bp-readings`)

Standard `WP_REST_Posts_Controller` endpoint for the `bp_reading` post type (not public; requires authentication). Meta fields: `reading_datetime` (ISO 8601, required), `systolic`/`diastolic` (integer, required, range-checked), `pulse` (integer, optional, range-checked), `weight` (number, optional), `notes` (string, optional). The post title is generated automatically from the vitals.
