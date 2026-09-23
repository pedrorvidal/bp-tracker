# API

REST endpoints exposed by the `bp-tracker` plugin. All routes live under the `bp-tracker/v1` namespace.

Base URL in local dev: `http://localhost:8888/wp-json`.

| Method   | Path                             | Auth required                | Description                      |
| -------- | -------------------------------- | ---------------------------- | -------------------------------- |
| `POST`   | `/bp-tracker/v1/auth/login`      | CSRF header                  | Exchange credentials for tokens  |
| `POST`   | `/bp-tracker/v1/auth/refresh`    | Refresh cookie + CSRF header | Rotate the refresh token         |
| `POST`   | `/bp-tracker/v1/auth/logout`     | Refresh cookie + CSRF header | Revoke the refresh token         |
| `POST`   | `/bp-tracker/v1/auth/logout-all` | Refresh cookie + CSRF header | Sign out of every device         |
| `GET`    | `/bp-tracker/v1/readings`        | Yes                          | List the caller's readings       |
| `POST`   | `/bp-tracker/v1/readings`        | Yes                          | Create a reading                 |
| `GET`    | `/bp-tracker/v1/readings/{id}`   | Yes (owner)                  | Get one reading                  |
| `PUT`    | `/bp-tracker/v1/readings/{id}`   | Yes (owner)                  | Partially update a reading       |
| `DELETE` | `/bp-tracker/v1/readings/{id}`   | Yes (owner)                  | Delete a reading                 |
| `GET`    | `/bp-tracker/v1/stats`           | Yes                          | Averages and count over a period |

## Conventions

### Headers

| Header                                 | When                                                            |
| -------------------------------------- | --------------------------------------------------------------- |
| `Authorization: Bearer <access_token>` | Every readings/stats route. **Never** on `/auth/*` (see below). |
| `X-BP-Tracker-CSRF: 1`                 | Every `/auth/*` route.                                          |
| `Content-Type: application/json`       | Every request that sends a JSON body (`POST`, `PUT`).           |

WordPress cookie authentication (with an `X-WP-Nonce` header) also works, since the routes only check for a logged-in user. The frontend uses Bearer tokens.

### Error format

Every error uses the standard WordPress REST error shape:

```json
{
  "code": "bp_tracker_rest_not_found",
  "message": "Reading not found.",
  "data": { "status": 404 }
}
```

Errors that apply to every route:

| Status | `code`                         | Cause                                                                                                          |
| ------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `400`  | `rest_missing_callback_param`  | A required parameter is missing. `data.params` lists the missing names.                                        |
| `400`  | `rest_invalid_param`           | A parameter has the wrong type, is out of range, or is not a valid date. See below.                            |
| `401`  | `bp_tracker_jwt_invalid_token` | An `Authorization: Bearer` header was sent, but the token is malformed, expired or signed with another secret. |

Example of `rest_invalid_param` (out-of-range value):

```json
{
  "code": "rest_invalid_param",
  "message": "Invalid parameter(s): systolic",
  "data": {
    "status": 400,
    "params": {
      "systolic": "systolic must be between 60 (inclusive) and 250 (inclusive)"
    },
    "details": {
      "systolic": {
        "code": "rest_out_of_bounds",
        "message": "systolic must be between 60 (inclusive) and 250 (inclusive)",
        "data": null
      }
    }
  }
}
```

Parameters are validated before permissions are checked. A request with invalid parameters therefore gets a `400` even when it has no valid token.

### CORS

Browsers may call the `bp-tracker/v1` namespace cross-origin only from the origin set in `BP_TRACKER_FRONTEND_ORIGIN` (see the README). That origin must match exactly: scheme, host and port. For that origin, every response, including the `OPTIONS` preflight, carries:

```
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, X-BP-Tracker-CSRF
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 600
Access-Control-Expose-Headers: X-WP-Total, X-WP-TotalPages, Link
Vary: Origin
```

Any other origin gets no `Access-Control-Allow-*` headers, so the browser blocks the request. Credentials are allowed only so the frontend can send the refresh cookie to `/auth/*`; the origin is never reflected. Send `/auth/*` requests with `credentials: 'include'` (axios: `withCredentials: true`). Data routes use the Bearer header and don't need credentials.

### Dates

All datetimes are ISO 8601 / RFC 3339 strings with a timezone offset, for example `2026-09-22T08:30:00+00:00`. In a query string, URL-encode the `+` as `%2B`.

---

## Authentication (`bp-tracker/v1/auth`)

Authentication is built into the plugin (`backend/includes/class-bp-tracker-jwt-auth.php`) and needs no third-party plugin.

- **Access token:** an HS256-signed JWT returned in the JSON body. It expires after 15 minutes (`expires_in: 900`); the short lifetime bounds how long a leaked token stays usable, and refreshing is transparent to users. Send it as `Authorization: Bearer <access_token>` to the readings and stats routes. Browsers should keep it in memory only.
- **Refresh token:** 32 random bytes, hex-encoded, valid for 30 days. It is **never in a response body**. The server sets it in a cookie that JavaScript can't read:

  ```
  Set-Cookie: bp_tracker_refresh=<token>; Path=/wp-json/bp-tracker/v1/auth; Max-Age=2592000; HttpOnly; SameSite=Strict[; Secure]
  ```

  | Attribute         | Effect                                                                                                                                      |
  | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
  | `HttpOnly`        | JavaScript, including an XSS payload, can't read it.                                                                                        |
  | `SameSite=Strict` | Other sites can't make the browser send it.                                                                                                 |
  | `Path`            | Sent to `/auth/*` only, never to data routes. With plain permalinks the path falls back to `/`.                                             |
  | `Secure`          | Added over HTTPS (`is_ssl()`). If a proxy terminates TLS without WordPress detecting it, use the `bp_tracker_refresh_cookie_secure` filter. |

  On the server, only a SHA-256 hash of each refresh token is stored (`wp_bp_tracker_refresh_tokens`). Every refresh consumes the presented token atomically and issues a new one, so each token works once, even when two requests present it at the same moment.

- **Reuse detection:** each login starts a token _family_, the chain of refresh tokens of one session. Every refresh marks the presented token as used, keeps it until it expires, and issues its successor in the same family. If a used token is presented again (to `refresh` or `logout-all`), someone holds a copy of it. Either an attacker already rotated a stolen token and the real client now presents the old one, or the reverse. Because the two can't be told apart, the **whole family is revoked**, which ends the attacker's copy too. The request gets `401 bp_tracker_jwt_invalid_refresh_token`, and the action `bp_tracker_refresh_token_reuse_detected( $user_id, $family_id )` fires so it can be logged or trigger an alert.

  Only that session is revoked; the user's other sessions (other families) are untouched. An access token the attacker already holds stays valid until it expires (at most 15 minutes). A lost refresh response can also trigger detection: the browser keeps the old cookie and presents it again. The effect is the same as without detection, because the old token no longer works either way: that device has to sign in again.

- **CSRF protection:** the browser sends the cookie automatically, so every `/auth/*` route requires the header `X-BP-Tracker-CSRF: 1`. A custom header forces a CORS preflight, which only `BP_TRACKER_FRONTEND_ORIGIN` passes. Without the header, the response is `403 bp_tracker_jwt_missing_csrf_header`.
- **Session revocation:** each access token carries the user's _session generation_ (`gen` claim). Revoking all of a user's sessions increments it, so every access token issued before is rejected immediately (`401 bp_tracker_jwt_invalid_token`), and all their refresh tokens are deleted. This happens:
  - when the password changes (reset, profile screen, WP-CLI, `wp_set_password()`);
  - on `POST /auth/logout-all` ("sign out of all devices").

  Deleting a user deletes their refresh tokens too. A daily WP-Cron job (`bp_tracker_purge_expired_refresh_tokens`) deletes expired refresh tokens; it is removed when the plugin is deactivated.

- **No Bearer on `/auth/*`:** any request with an invalid or expired `Authorization: Bearer` header is rejected with `401 bp_tracker_jwt_invalid_token` before it reaches the route. Clients must not send one to `/auth/*`, which is exactly when a stale access token is likely.

The login and refresh responses share one shape:

```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "token_type": "Bearer",
  "expires_in": 900,
  "user": { "id": 1, "username": "admin", "display_name": "Ada Admin" }
}
```

Errors shared by the auth routes:

| Status | `code`                               | Cause                                                         |
| ------ | ------------------------------------ | ------------------------------------------------------------- |
| `403`  | `bp_tracker_jwt_missing_csrf_header` | `X-BP-Tracker-CSRF: 1` missing or with another value          |
| `401`  | `bp_tracker_jwt_invalid_token`       | An invalid or expired `Authorization: Bearer` header was sent |
| `500`  | `bp_tracker_jwt_misconfigured`       | `BP_TRACKER_JWT_SECRET` is not defined in `wp-config.php`     |

The curl examples below keep the cookie in a jar file (`-c` writes it, `-b` sends it), the same way a browser does.

### `POST /bp-tracker/v1/auth/login`

Checks the credentials with `wp_authenticate()`. Returns the access token and user, and sets the refresh cookie.

**Headers:** `Content-Type: application/json`, `X-BP-Tracker-CSRF: 1`

**Body:**

| Field      | Type   | Required                  |
| ---------- | ------ | ------------------------- |
| `username` | string | Yes (login name or email) |
| `password` | string | Yes                       |

```bash
curl -s -c cookies.txt -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-BP-Tracker-CSRF: 1" \
  -d '{"username":"admin","password":"password"}'
```

**Success: `200 OK`.** The body has the shape above, plus a `Set-Cookie: bp_tracker_refresh=…` header.

**Errors:**

| Status | `code`                               | Cause                            |
| ------ | ------------------------------------ | -------------------------------- |
| `400`  | `rest_missing_callback_param`        | `username` or `password` missing |
| `403`  | `bp_tracker_jwt_invalid_credentials` | Wrong username or password       |
| `429`  | `bp_tracker_jwt_too_many_attempts`   | Too many failed attempts (below) |

```json
{
  "code": "bp_tracker_jwt_invalid_credentials",
  "message": "Invalid username or password.",
  "data": { "status": 403 }
}
```

**Rate limiting.** Failed logins are counted in three buckets, each over a fixed 15-minute window:

| Bucket           | Limit | Purpose                                                                         |
| ---------------- | ----- | ------------------------------------------------------------------------------- |
| account + IP     | 5     | Stops brute force without letting an attacker lock the real user out everywhere |
| IP (any account) | 20    | Stops one address from trying many accounts                                     |
| account (any IP) | 50    | Stops distributed attacks on one account                                        |

- **While a bucket is full,** every attempt gets `429`, **even with the correct password**, because the lock is checked before the password.
- **The account** is identified by login name or email, which count as one account. Unknown usernames are counted the same way, so the response doesn't reveal which accounts exist.
- **A successful login** resets that account's buckets but not the IP bucket.
- **The client IP** is `REMOTE_ADDR`. Behind a reverse proxy, set the real client IP with the `bp_tracker_client_ip` filter. Only do that when the header comes from your own proxy.

The response includes a `Retry-After` header. The same value is also in the body, because browsers don't expose `Retry-After` to cross-origin JavaScript:

```json
{
  "code": "bp_tracker_jwt_too_many_attempts",
  "message": "Too many failed login attempts. Try again later.",
  "data": { "status": 429, "retry_after": 812 }
}
```

### `POST /bp-tracker/v1/auth/refresh`

Exchanges the refresh cookie for a new access token. It also rotates the cookie: the presented token is marked used and its successor, in the same family, is set. The request has no body. Presenting a token that was already used revokes its whole family (see _Reuse detection_ above).

**Headers:** `X-BP-Tracker-CSRF: 1`, plus the `bp_tracker_refresh` cookie

```bash
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/refresh \
  -H "X-BP-Tracker-CSRF: 1"
```

**Success: `200 OK`.** The body has the same shape as login, with a new `access_token`, plus a new `Set-Cookie`.

**Errors:**

| Status | `code`                                 | Cause                                                                                                                                                                |
| ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`  | `bp_tracker_jwt_invalid_refresh_token` | The cookie is missing or malformed, or its token is unknown, expired or revoked, or its user was deleted. If the token was already used, its family is also revoked. |

The 401 also clears the cookie (`Max-Age=0`):

```json
{
  "code": "bp_tracker_jwt_invalid_refresh_token",
  "message": "Invalid or expired refresh token.",
  "data": { "status": 401 }
}
```

### `POST /bp-tracker/v1/auth/logout`

Ends the cookie's session: revokes its whole token family, including a copy an attacker may have rotated, and clears the cookie. No access token is needed: holding the refresh token proves the right to revoke it, and logout must also work after the access token has expired. The request has no body.

**Headers:** `X-BP-Tracker-CSRF: 1`, plus the `bp_tracker_refresh` cookie

```bash
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/logout \
  -H "X-BP-Tracker-CSRF: 1"
```

**Success: `200 OK`.** The response includes `Set-Cookie: bp_tracker_refresh=; …; Max-Age=0`.

```json
{ "success": true }
```

The response is `200` even without a cookie, or with a token that was already revoked, so logging out twice is safe. It only ends the presented token's session; the user's other sessions (other devices) are untouched. Use `logout-all` to end those too.

### `POST /bp-tracker/v1/auth/logout-all`

Signs the cookie's owner out of **every device**. It deletes all of their refresh tokens and invalidates every access token issued so far, including this device's, then clears the cookie. Like logout, it is authenticated by the refresh cookie, not by an access token. The request has no body.

**Headers:** `X-BP-Tracker-CSRF: 1`, plus the `bp_tracker_refresh` cookie

```bash
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/logout-all \
  -H "X-BP-Tracker-CSRF: 1"
```

**Success: `200 OK`.** The response includes `Set-Cookie: bp_tracker_refresh=; …; Max-Age=0`. `revoked_sessions` counts the refresh tokens deleted:

```json
{ "success": true, "revoked_sessions": 3 }
```

**Errors:**

| Status | `code`                                 | Cause                                                                                                                           |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `401`  | `bp_tracker_jwt_invalid_refresh_token` | No valid refresh cookie, so nothing else is revoked. A cookie that was already used counts as reuse and revokes its own family. |

---

## Readings (`bp-tracker/v1`)

These routes are served by a custom controller (`backend/includes/class-bp-tracker-rest-controller.php`) over the `bp_reading` post type, not by the default `wp/v2` posts controller. `show_in_rest` is `false` on the post type, so `wp/v2/bp-readings` does not exist.

Every route needs an authenticated user and only works with that user's own readings.

### Reading object

Every route that returns readings uses this shape. The raw post object is never returned.

```json
{
  "id": 7,
  "reading_datetime": "2026-09-22T08:30:00+00:00",
  "systolic": 118,
  "diastolic": 76,
  "pulse": 65,
  "weight": 72.5,
  "notes": "Before breakfast"
}
```

| Field              | Type           | On create | Constraints                     |
| ------------------ | -------------- | --------- | ------------------------------- |
| `id`               | integer        | Read-only |                                 |
| `reading_datetime` | string         | Required  | ISO 8601 date-time              |
| `systolic`         | integer        | Required  | 60–250 mmHg                     |
| `diastolic`        | integer        | Required  | 40–150 mmHg                     |
| `pulse`            | integer / null | Optional  | 30–220 bpm; `null` when not set |
| `weight`           | number / null  | Optional  | `null` when not set             |
| `notes`            | string         | Optional  | `""` when not set               |

### Errors shared by the readings routes

| Status | `code`                      | Cause                                                              |
| ------ | --------------------------- | ------------------------------------------------------------------ |
| `401`  | `bp_tracker_rest_forbidden` | No authenticated user                                              |
| `403`  | `bp_tracker_rest_forbidden` | The reading belongs to another user (`/readings/{id}` routes only) |
| `404`  | `bp_tracker_rest_not_found` | The reading doesn't exist (`/readings/{id}` routes only)           |

```json
{
  "code": "bp_tracker_rest_forbidden",
  "message": "You must be logged in to view readings.",
  "data": { "status": 401 }
}
```

```json
{
  "code": "bp_tracker_rest_forbidden",
  "message": "You can only access your own readings.",
  "data": { "status": 403 }
}
```

```json
{
  "code": "bp_tracker_rest_not_found",
  "message": "Reading not found.",
  "data": { "status": 404 }
}
```

### `GET /bp-tracker/v1/readings`

Lists the caller's readings, newest `reading_datetime` first, with pagination.

**Headers:** `Authorization: Bearer <access_token>`

**Query parameters:**

| Param          | Type    | Default | Constraints                   |
| -------------- | ------- | ------- | ----------------------------- |
| `page`         | integer | `1`     | ≥ 1                           |
| `per_page`     | integer | `10`    | 1–100                         |
| `period_start` | string  | none    | ISO 8601 date-time, inclusive |
| `period_end`   | string  | none    | ISO 8601 date-time, inclusive |

```bash
curl -s -i "http://localhost:8888/wp-json/bp-tracker/v1/readings?per_page=20&period_start=2026-09-01T00:00:00%2B00:00" \
  -H "Authorization: Bearer $access_token"
```

**Success: `200 OK`.** The body is a plain JSON array. Totals are sent in response headers:

```
X-WP-Total: 2
X-WP-TotalPages: 1
```

```json
[
  {
    "id": 7,
    "reading_datetime": "2026-09-22T08:30:00+00:00",
    "systolic": 118,
    "diastolic": 76,
    "pulse": 65,
    "weight": 72.5,
    "notes": "Before breakfast"
  },
  {
    "id": 8,
    "reading_datetime": "2026-09-21T20:00:00+00:00",
    "systolic": 124,
    "diastolic": 82,
    "pulse": null,
    "weight": null,
    "notes": ""
  }
]
```

If the page is past the last page, the response is `200` with an empty array `[]`.

**Errors:** `400 rest_invalid_param` for an out-of-range `page`/`per_page` or an invalid date, and `401` when the caller isn't authenticated.

```json
{
  "code": "rest_invalid_param",
  "message": "Invalid parameter(s): per_page",
  "data": {
    "status": 400,
    "params": {
      "per_page": "per_page must be between 1 (inclusive) and 100 (inclusive)"
    },
    "details": {
      "per_page": {
        "code": "rest_out_of_bounds",
        "message": "per_page must be between 1 (inclusive) and 100 (inclusive)",
        "data": null
      }
    }
  }
}
```

### `POST /bp-tracker/v1/readings`

Creates a reading owned by the caller.

**Headers:** `Authorization: Bearer <access_token>`, `Content-Type: application/json`

**Body:** `reading_datetime`, `systolic` and `diastolic` are required. `pulse`, `weight` and `notes` are optional. See [Reading object](#reading-object) for the constraints.

```bash
curl -s -X POST http://localhost:8888/wp-json/bp-tracker/v1/readings \
  -H "Authorization: Bearer $access_token" \
  -H "Content-Type: application/json" \
  -d '{"reading_datetime":"2026-09-22T08:30:00+00:00","systolic":118,"diastolic":76,"pulse":65,"weight":72.5,"notes":"Before breakfast"}'
```

**Success: `201 Created`**

```json
{
  "id": 7,
  "reading_datetime": "2026-09-22T08:30:00+00:00",
  "systolic": 118,
  "diastolic": 76,
  "pulse": 65,
  "weight": 72.5,
  "notes": "Before breakfast"
}
```

**Errors:**

| Status | `code`                        | Cause                                                              |
| ------ | ----------------------------- | ------------------------------------------------------------------ |
| `400`  | `rest_missing_callback_param` | A required field is missing                                        |
| `400`  | `rest_invalid_param`          | A field is out of range, has the wrong type or has an invalid date |
| `401`  | `bp_tracker_rest_forbidden`   | Not authenticated                                                  |

```json
{
  "code": "rest_missing_callback_param",
  "message": "Missing parameter(s): reading_datetime, diastolic",
  "data": { "status": 400, "params": ["reading_datetime", "diastolic"] }
}
```

### `GET /bp-tracker/v1/readings/{id}`

Returns one reading. Only the reading's owner can fetch it.

**Headers:** `Authorization: Bearer <access_token>`

```bash
curl -s http://localhost:8888/wp-json/bp-tracker/v1/readings/7 \
  -H "Authorization: Bearer $access_token"
```

**Success: `200 OK`.** The body is a [reading object](#reading-object).

**Errors:** `401`, `403` or `404`, as described in [Errors shared by the readings routes](#errors-shared-by-the-readings-routes).

### `PUT /bp-tracker/v1/readings/{id}`

Partial update: send only the fields you want to change. Fields you leave out keep their current values. Only the reading's owner can update it.

**Headers:** `Authorization: Bearer <access_token>`, `Content-Type: application/json`

**Body:** any subset of `reading_datetime`, `systolic`, `diastolic`, `pulse`, `weight` and `notes`. The same constraints as on create apply.

```bash
curl -s -X PUT http://localhost:8888/wp-json/bp-tracker/v1/readings/7 \
  -H "Authorization: Bearer $access_token" \
  -H "Content-Type: application/json" \
  -d '{"systolic":122}'
```

**Success: `200 OK`.** The body is the full, updated reading:

```json
{
  "id": 7,
  "reading_datetime": "2026-09-22T08:30:00+00:00",
  "systolic": 122,
  "diastolic": 76,
  "pulse": 65,
  "weight": 72.5,
  "notes": "Before breakfast"
}
```

**Errors:**

| Status                | `code`                                                     | Cause                                         |
| --------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| `400`                 | `rest_invalid_param`                                       | A field is out of range or has the wrong type |
| `400`                 | `bp_tracker_rest_invalid_value`                            | A value was rejected when it was stored       |
| `401` / `403` / `404` | see [shared errors](#errors-shared-by-the-readings-routes) |                                               |

```json
{
  "code": "rest_invalid_param",
  "message": "Invalid parameter(s): diastolic",
  "data": {
    "status": 400,
    "params": {
      "diastolic": "diastolic must be between 40 (inclusive) and 150 (inclusive)"
    },
    "details": {
      "diastolic": {
        "code": "rest_out_of_bounds",
        "message": "diastolic must be between 40 (inclusive) and 150 (inclusive)",
        "data": null
      }
    }
  }
}
```

### `DELETE /bp-tracker/v1/readings/{id}`

Permanently deletes a reading. It does not go to the trash. Only the reading's owner can delete it.

**Headers:** `Authorization: Bearer <access_token>`

```bash
curl -s -X DELETE http://localhost:8888/wp-json/bp-tracker/v1/readings/7 \
  -H "Authorization: Bearer $access_token"
```

**Success: `200 OK`**

```json
{ "deleted": true, "id": 7 }
```

**Errors:**

| Status                | `code`                                                     | Cause                               |
| --------------------- | ---------------------------------------------------------- | ----------------------------------- |
| `500`                 | `bp_tracker_rest_delete_failed`                            | WordPress could not delete the post |
| `401` / `403` / `404` | see [shared errors](#errors-shared-by-the-readings-routes) |                                     |

### `GET /bp-tracker/v1/stats`

Returns the systolic, diastolic and pulse averages and the reading count for the caller's own readings, optionally limited to a period. Averages are rounded to one decimal. They are sent as JSON numbers, so a whole value appears as `123`, not `123.0`. An average is `null` when there is no data for it. `pulse_average` only includes readings that have a pulse value.

**Headers:** `Authorization: Bearer <access_token>`

**Query parameters:**

| Param          | Type   | Constraints                   |
| -------------- | ------ | ----------------------------- |
| `period_start` | string | ISO 8601 date-time, inclusive |
| `period_end`   | string | ISO 8601 date-time, inclusive |

```bash
curl -s "http://localhost:8888/wp-json/bp-tracker/v1/stats?period_start=2026-09-01T00:00:00%2B00:00&period_end=2026-09-30T23:59:59%2B00:00" \
  -H "Authorization: Bearer $access_token"
```

**Success: `200 OK`.** This example uses the two readings from the list example above:

```json
{
  "count": 2,
  "systolic_average": 121,
  "diastolic_average": 79,
  "pulse_average": 65
}
```

When there are no readings in the period:

```json
{
  "count": 0,
  "systolic_average": null,
  "diastolic_average": null,
  "pulse_average": null
}
```

**Errors:** `400 rest_invalid_param` for an invalid date, and `401` when the caller isn't authenticated.

```json
{
  "code": "rest_invalid_param",
  "message": "Invalid parameter(s): period_start",
  "data": {
    "status": 400,
    "params": { "period_start": "Invalid date." },
    "details": {
      "period_start": {
        "code": "rest_invalid_date",
        "message": "Invalid date.",
        "data": null
      }
    }
  }
}
```

---

## End-to-end example

This script needs [`jq`](https://jqlang.github.io/jq/). The refresh token stays in `cookies.txt`; the script never reads it.

```bash
BASE=http://localhost:8888/wp-json/bp-tracker/v1
JAR=cookies.txt

# 1. Log in: access token from the body, refresh token into the cookie jar
access_token=$(curl -s -c $JAR -X POST $BASE/auth/login \
  -H "Content-Type: application/json" -H "X-BP-Tracker-CSRF: 1" \
  -d '{"username":"admin","password":"password"}' | jq -r .access_token)

# 2. Create a reading and list readings
curl -s -X POST $BASE/readings \
  -H "Authorization: Bearer $access_token" \
  -H "Content-Type: application/json" \
  -d '{"reading_datetime":"2026-09-22T08:30:00+00:00","systolic":118,"diastolic":76}'
curl -s $BASE/readings -H "Authorization: Bearer $access_token"

# 3. Refresh (rotates the cookie in the jar)
access_token=$(curl -s -b $JAR -c $JAR -X POST $BASE/auth/refresh \
  -H "X-BP-Tracker-CSRF: 1" | jq -r .access_token)

# 4. Log out: revokes the refresh token and clears the cookie
curl -s -b $JAR -c $JAR -X POST $BASE/auth/logout -H "X-BP-Tracker-CSRF: 1"
rm -f $JAR
```
