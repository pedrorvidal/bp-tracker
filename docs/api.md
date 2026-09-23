# API

REST endpoints exposed by the `bp-tracker` plugin. All routes live under the `bp-tracker/v1` namespace.

Base URL in local dev: `http://localhost:8888/wp-json`.

| Method   | Path                              | Auth required | Description                          |
| -------- | --------------------------------- | ------------- | ------------------------------------ |
| `POST`   | `/bp-tracker/v1/auth/login`       | No            | Exchange credentials for tokens      |
| `POST`   | `/bp-tracker/v1/auth/refresh`     | No            | Rotate a refresh token               |
| `POST`   | `/bp-tracker/v1/auth/logout`      | Yes           | Revoke a refresh token               |
| `GET`    | `/bp-tracker/v1/readings`         | Yes           | List the caller's readings           |
| `POST`   | `/bp-tracker/v1/readings`         | Yes           | Create a reading                     |
| `GET`    | `/bp-tracker/v1/readings/{id}`    | Yes (owner)   | Get one reading                      |
| `PUT`    | `/bp-tracker/v1/readings/{id}`    | Yes (owner)   | Partially update a reading           |
| `DELETE` | `/bp-tracker/v1/readings/{id}`    | Yes (owner)   | Delete a reading                     |
| `GET`    | `/bp-tracker/v1/stats`            | Yes           | Averages and count over a period     |

## Conventions

### Headers

| Header                                  | When                                                     |
| --------------------------------------- | -------------------------------------------------------- |
| `Authorization: Bearer <access_token>`  | Every route marked "Auth required" above.                |
| `Content-Type: application/json`        | Every request that sends a JSON body (`POST`, `PUT`).    |

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

| Status | `code`                         | Cause                                                                                    |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `400`  | `rest_missing_callback_param`  | A required parameter is missing. `data.params` lists the missing names.                  |
| `400`  | `rest_invalid_param`           | A parameter has the wrong type, is out of range, or is not a valid date. See below.       |
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
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Max-Age: 600
Access-Control-Expose-Headers: X-WP-Total, X-WP-TotalPages, Link
Vary: Origin
```

Any other origin gets no `Access-Control-Allow-*` headers, so the browser blocks the request. `Access-Control-Allow-Credentials` is never sent. Authenticate with the `Authorization: Bearer` header, not cookies, and don't use `credentials: 'include'` or `withCredentials: true`.

### Dates

All datetimes are ISO 8601 / RFC 3339 strings with a timezone offset, for example `2026-09-22T08:30:00+00:00`. In a query string, URL-encode the `+` as `%2B`.

---

## Authentication (`bp-tracker/v1/auth`)

Authentication is built into the plugin (`backend/includes/class-bp-tracker-jwt-auth.php`) and needs no third-party plugin.

- **Access tokens** are HS256-signed JWTs that expire after 1 hour (`expires_in: 3600`).
- **Refresh tokens** are opaque random strings that last 30 days. They are stored hashed and can be used only once: every refresh rotates them. They can also be revoked, which a bare JWT cannot be.

Send the access token as `Authorization: Bearer <access_token>`. The token authenticates the user on any REST route they can access, not only the `bp-tracker/v1` namespace.

Error that applies to all three auth routes:

| Status | `code`                         | Cause                                                          |
| ------ | ------------------------------ | -------------------------------------------------------------- |
| `500`  | `bp_tracker_jwt_misconfigured` | `BP_TRACKER_JWT_SECRET` is not defined in `wp-config.php`.     |

### `POST /bp-tracker/v1/auth/login`

Checks the credentials with `wp_authenticate()` and returns a new token pair.

**Headers:** `Content-Type: application/json`

**Body:**

| Field      | Type   | Required |
| ---------- | ------ | -------- |
| `username` | string | Yes      |
| `password` | string | Yes      |

```bash
curl -s -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'
```

**Success: `200 OK`**

```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refresh_token": "66ebb904a79295817cf2bf8e26dbe40006bfb9b7809fd37e81aa1ae59a1025dc",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Errors:**

| Status | `code`                                | Cause                            |
| ------ | ------------------------------------- | -------------------------------- |
| `400`  | `rest_missing_callback_param`         | `username` or `password` missing |
| `403`  | `bp_tracker_jwt_invalid_credentials`  | Wrong username or password       |

```json
{
  "code": "bp_tracker_jwt_invalid_credentials",
  "message": "Invalid username or password.",
  "data": { "status": 403 }
}
```

### `POST /bp-tracker/v1/auth/refresh`

Exchanges a refresh token for a new access/refresh token pair. The refresh token that was sent is deleted, so it can't be used again.

**Headers:** `Content-Type: application/json`

**Body:**

| Field           | Type   | Required |
| --------------- | ------ | -------- |
| `refresh_token` | string | Yes      |

```bash
curl -s -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"66ebb904a79295817cf2bf8e26dbe40006bfb9b7809fd37e81aa1ae59a1025dc"}'
```

**Success: `200 OK`.** The response has the same shape as the login response, with new values:

```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refresh_token": "b3cf2d88b596b955b3c43d9b4ed755ad33c95efe959ce79c5f70913fc7bb5254",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Errors:**

| Status | `code`                                 | Cause                                                   |
| ------ | -------------------------------------- | ------------------------------------------------------- |
| `400`  | `rest_missing_callback_param`          | `refresh_token` missing                                 |
| `401`  | `bp_tracker_jwt_invalid_refresh_token` | The token is unknown, expired, already used or revoked  |

```json
{
  "code": "bp_tracker_jwt_invalid_refresh_token",
  "message": "Invalid or expired refresh token.",
  "data": { "status": 401 }
}
```

### `POST /bp-tracker/v1/auth/logout`

Revokes a refresh token that belongs to the authenticated user. The access token stays valid until it expires, so the client must discard it.

**Headers:** `Authorization: Bearer <access_token>`, `Content-Type: application/json`

**Body:**

| Field           | Type   | Required |
| --------------- | ------ | -------- |
| `refresh_token` | string | Yes      |

```bash
curl -s -X POST http://localhost:8888/wp-json/bp-tracker/v1/auth/logout \
  -H "Authorization: Bearer $access_token" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$refresh_token\"}"
```

**Success: `200 OK`**

```json
{ "success": true }
```

The response is `200` even when the refresh token didn't exist or was already revoked, so logging out twice is safe.

**Errors:**

| Status | `code`                         | Cause                    |
| ------ | ------------------------------ | ------------------------ |
| `400`  | `rest_missing_callback_param`  | `refresh_token` missing  |
| `401`  | `bp_tracker_jwt_unauthorized`  | No access token sent     |
| `401`  | `bp_tracker_jwt_invalid_token` | Access token invalid     |

```json
{
  "code": "bp_tracker_jwt_unauthorized",
  "message": "Authentication required.",
  "data": { "status": 401 }
}
```

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

| Field              | Type           | On create | Constraints                                    |
| ------------------ | -------------- | --------- | ---------------------------------------------- |
| `id`               | integer        | Read-only |                                                |
| `reading_datetime` | string         | Required  | ISO 8601 date-time                             |
| `systolic`         | integer        | Required  | 60–250 mmHg                                    |
| `diastolic`        | integer        | Required  | 40–150 mmHg                                    |
| `pulse`            | integer / null | Optional  | 30–220 bpm; `null` when not set                |
| `weight`           | number / null  | Optional  | `null` when not set                            |
| `notes`            | string         | Optional  | `""` when not set                              |

### Errors shared by the readings routes

| Status | `code`                        | Cause                                                              |
| ------ | ----------------------------- | ------------------------------------------------------------------ |
| `401`  | `bp_tracker_rest_forbidden`   | No authenticated user                                              |
| `403`  | `bp_tracker_rest_forbidden`   | The reading belongs to another user (`/readings/{id}` routes only) |
| `404`  | `bp_tracker_rest_not_found`   | The reading doesn't exist (`/readings/{id}` routes only)           |

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

| Param          | Type    | Default | Constraints                          |
| -------------- | ------- | ------- | ------------------------------------ |
| `page`         | integer | `1`     | ≥ 1                                  |
| `per_page`     | integer | `10`    | 1–100                                |
| `period_start` | string  | none    | ISO 8601 date-time, inclusive        |
| `period_end`   | string  | none    | ISO 8601 date-time, inclusive        |

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
    "params": { "per_page": "per_page must be between 1 (inclusive) and 100 (inclusive)" },
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

| Status | `code`                        | Cause                                                    |
| ------ | ----------------------------- | -------------------------------------------------------- |
| `400`  | `rest_missing_callback_param` | A required field is missing                              |
| `400`  | `rest_invalid_param`          | A field is out of range, has the wrong type or has an invalid date |
| `401`  | `bp_tracker_rest_forbidden`   | Not authenticated                                        |

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

| Status | `code`                          | Cause                                         |
| ------ | ------------------------------- | --------------------------------------------- |
| `400`  | `rest_invalid_param`            | A field is out of range or has the wrong type |
| `400`  | `bp_tracker_rest_invalid_value` | A value was rejected when it was stored       |
| `401` / `403` / `404` | see [shared errors](#errors-shared-by-the-readings-routes) | |

```json
{
  "code": "rest_invalid_param",
  "message": "Invalid parameter(s): diastolic",
  "data": {
    "status": 400,
    "params": { "diastolic": "diastolic must be between 40 (inclusive) and 150 (inclusive)" },
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

| Status | `code`                          | Cause                                     |
| ------ | ------------------------------- | ----------------------------------------- |
| `500`  | `bp_tracker_rest_delete_failed` | WordPress could not delete the post       |
| `401` / `403` / `404` | see [shared errors](#errors-shared-by-the-readings-routes) | |

### `GET /bp-tracker/v1/stats`

Returns the systolic, diastolic and pulse averages and the reading count for the caller's own readings, optionally limited to a period. Averages are rounded to one decimal. They are sent as JSON numbers, so a whole value appears as `123`, not `123.0`. An average is `null` when there is no data for it. `pulse_average` only includes readings that have a pulse value.

**Headers:** `Authorization: Bearer <access_token>`

**Query parameters:**

| Param          | Type   | Constraints                    |
| -------------- | ------ | ------------------------------ |
| `period_start` | string | ISO 8601 date-time, inclusive  |
| `period_end`   | string | ISO 8601 date-time, inclusive  |

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
      "period_start": { "code": "rest_invalid_date", "message": "Invalid date.", "data": null }
    }
  }
}
```

---

## End-to-end example

This script needs [`jq`](https://jqlang.github.io/jq/).

```bash
BASE=http://localhost:8888/wp-json/bp-tracker/v1

# 1. Log in, keep both tokens
resp=$(curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}')
access_token=$(echo "$resp" | jq -r .access_token)
refresh_token=$(echo "$resp" | jq -r .refresh_token)

# 2. Create a reading and list readings
curl -s -X POST $BASE/readings \
  -H "Authorization: Bearer $access_token" \
  -H "Content-Type: application/json" \
  -d '{"reading_datetime":"2026-09-22T08:30:00+00:00","systolic":118,"diastolic":76}'
curl -s $BASE/readings -H "Authorization: Bearer $access_token"

# 3. Refresh when the access token is close to expiring
resp=$(curl -s -X POST $BASE/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$refresh_token\"}")
access_token=$(echo "$resp" | jq -r .access_token)
refresh_token=$(echo "$resp" | jq -r .refresh_token)

# 4. Log out (revokes the refresh token)
curl -s -X POST $BASE/auth/logout \
  -H "Authorization: Bearer $access_token" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$refresh_token\"}"
```
