# API

REST endpoints exposed by the `bp-tracker` plugin. Base URL in local dev: `http://localhost:8888/wp-json`.

## Authentication (`bp-tracker/v1/auth`)

First-party JWT auth (`backend/includes/class-bp-tracker-jwt-auth.php`) — no third-party plugin. Access tokens are short-lived JWTs (1h); refresh tokens are long-lived (30 days), opaque, single-use (rotated on every refresh) and revocable, since a bare JWT can't be invalidated on its own.

Send the access token on subsequent requests as `Authorization: Bearer <access_token>`. This also authenticates any other REST route the current user can access, not just the `bp-tracker/v1` namespace.

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
curl -s http://localhost:8888/wp-json/bp-tracker/v1/readings \
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

## Readings (`bp-tracker/v1`)

Custom controller (`backend/includes/class-bp-tracker-rest-controller.php`) over the `bp_reading` post type — not the default `wp/v2` posts controller (`show_in_rest` is `false` on the post type; there is no `wp/v2/bp-readings`). Every route requires `Authorization: Bearer <access_token>`; single-item routes 404 if the reading doesn't exist and 403 if it exists but belongs to another user. Responses are always the formatted shape below, never the raw post object:

```json
{
  "id": 6,
  "reading_datetime": "2026-09-22T08:30:00+00:00",
  "systolic": 118,
  "diastolic": 76,
  "pulse": 65,
  "weight": 72.5,
  "notes": "Before breakfast"
}
```

`pulse`/`weight` are `null` when not set. `systolic`/`diastolic` are required (range-checked: 60–250 / 40–150); `pulse` (30–220), `weight` and `notes` are optional. Out-of-range or missing required values → `400 rest_invalid_param`.

### `GET /bp-tracker/v1/readings`

Query params: `page` (default `1`), `per_page` (default `10`, max `100`), `period_start`, `period_end` (both ISO 8601, inclusive). Only the caller's own readings, newest first. Response is a plain array; total counts are in the `X-WP-Total` / `X-WP-TotalPages` headers.

```bash
curl -s "http://localhost:8888/wp-json/bp-tracker/v1/readings?per_page=20&period_start=2026-09-01T00:00:00%2B00:00" \
  -H "Authorization: Bearer $access_token"
```

### `POST /bp-tracker/v1/readings`

Body: `reading_datetime`, `systolic`, `diastolic` (required), `pulse`, `weight`, `notes` (optional). Returns `201` with the created reading.

```bash
curl -s -X POST http://localhost:8888/wp-json/bp-tracker/v1/readings \
  -H "Authorization: Bearer $access_token" -H "Content-Type: application/json" \
  -d '{"reading_datetime":"2026-09-22T08:30:00+00:00","systolic":118,"diastolic":76,"pulse":65,"weight":72.5,"notes":"Before breakfast"}'
```

### `GET /bp-tracker/v1/readings/{id}`

```bash
curl -s http://localhost:8888/wp-json/bp-tracker/v1/readings/6 -H "Authorization: Bearer $access_token"
```

### `PUT /bp-tracker/v1/readings/{id}`

Partial update — only send the fields you want to change. Owner only.

```bash
curl -s -X PUT http://localhost:8888/wp-json/bp-tracker/v1/readings/6 \
  -H "Authorization: Bearer $access_token" -H "Content-Type: application/json" \
  -d '{"systolic":122}'
```

### `DELETE /bp-tracker/v1/readings/{id}`

Owner only. Returns `{"deleted": true, "id": 6}`.

```bash
curl -s -X DELETE http://localhost:8888/wp-json/bp-tracker/v1/readings/6 -H "Authorization: Bearer $access_token"
```

### `GET /bp-tracker/v1/stats`

Averages (rounded to 1 decimal, `null` when there's no data) and a count, scoped to the caller's own readings within the optional `period_start`/`period_end`.

```bash
curl -s "http://localhost:8888/wp-json/bp-tracker/v1/stats?period_start=2026-09-01T00:00:00%2B00:00&period_end=2026-09-30T23:59:59%2B00:00" \
  -H "Authorization: Bearer $access_token"
# => {"count":3,"systolic_average":120.0,"diastolic_average":80.0,"pulse_average":70.0}
```
