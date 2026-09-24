# Architecture

Other sections are still to be written. For the REST API, see [`api.md`](api.md).

## User roles and approval flow

End users only ever use the React app. WordPress is the API and the place where an administrator manages accounts.

### Roles

| Role                 | Who                              | Capabilities                                                                                     |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `bp_tracker_pending` | Someone who signed up in the app | None. The app login is refused with "Your account is pending approval."                          |
| `bp_tracker_user`    | An approved user                 | `read` plus creating, editing and deleting **their own** readings. Never anyone else's.          |
| `administrator`      | Manages users; owns no app data  | Everything in WordPress, plus the own-readings capabilities. Never restricted by the rules below |

The roles are defined in `backend/includes/class-bp-tracker-roles.php`. The capability list is in [`api.md`](api.md#roles-and-approval).

### Approval flow

1. A person signs up in the app (`POST /bp-tracker/v1/auth/register`). The account is created with the `bp_tracker_pending` role and gets no token.
2. An administrator opens **Users** in wp-admin and filters the list by the **BP Tracker: pending approval** role (the role links above the table).
3. They select the accounts to approve and use the **Change role to…** control above the table, picking **BP Tracker: user**, then **Change**.
4. The person can now sign in to the app.

Setting a user back to pending revokes all of their sessions at once.

### End users never use WordPress directly

`backend/includes/class-bp-tracker-access-control.php` applies to users with either app role, and never to an administrator (even one who also holds an app role):

- **wp-admin:** any wp-admin page load redirects to the app (`BP_TRACKER_FRONTEND_ORIGIN`). AJAX (`admin-ajax.php`) and REST requests are left alone, since a redirect would only break them.
- **Native login form:** after logging in through `wp-login.php`, they are sent to the app, whatever `redirect_to` asked for.
- **REST API:** any route outside `bp-tracker/v1` (for example `/wp/v2/users/me`) returns `403 bp_tracker_forbidden_route`. Logged-out requests are not affected; core handles them as usual.

The frontend's host is added to `allowed_redirect_hosts`, so `wp_safe_redirect()` accepts it when the app runs on a different host than WordPress. Without `BP_TRACKER_FRONTEND_ORIGIN`, the redirects go to the site's home page.

## Error reporting and debug settings

PHP errors must never reach the browser. An on-screen warning shows file paths, plugin and library versions, and sometimes query fragments, all of which help an attacker. Errors go to a log file that is not served over HTTP.

### Local development (wp-env)

`.wp-env.json` sets the debug constants explicitly, for both sites:

| Constant           | Dev site (`:8888`)   | Test site (`:8889`)  | Why                                                  |
| ------------------ | -------------------- | -------------------- | ---------------------------------------------------- |
| `WP_DEBUG`         | `true`               | `false`              | Surfaces notices and deprecations while developing   |
| `WP_DEBUG_DISPLAY` | `false`              | `false`              | Errors are never printed into pages or API responses |
| `WP_DEBUG_LOG`     | `/tmp/wp-errors.log` | `/tmp/wp-errors.log` | Errors are logged **outside the web root**           |
| `SCRIPT_DEBUG`     | `true`               | (wp-env default)     | Unminified core scripts                              |

`WP_DEBUG_LOG` is a path rather than `true` on purpose: `true` writes to `wp-content/debug.log`, which the web server serves to anyone who asks for it (it returned `200` here before this was changed). Read the log with:

```bash
npx wp-env run wordpress tail -f /tmp/wp-errors.log        # dev site
npx wp-env run tests-wordpress tail -f /tmp/wp-errors.log  # test site
```

The file lives in the container's `/tmp`, so it is lost when wp-env recreates the containers. WP-CLI commands (`wp-env run cli …`) print their errors to the terminal instead.

WordPress only applies `WP_DEBUG_DISPLAY` and `WP_DEBUG_LOG` when `WP_DEBUG` is on (`wp_debug_mode()`). On the test site, where it is off, they are declared only so that turning `WP_DEBUG` on there can't start printing errors. What actually keeps errors off that site's pages is PHP's own `display_errors`, which is off in the wp-env web containers: a deliberate fatal error there shows only the generic "WordPress › Error" page, with no path or function name.

### Anywhere other than localhost

If this project is ever hosted outside localhost (staging, production, a demo on a shared server):

- **Turn full debugging off.** `WP_DEBUG` must be `false` and `WP_DEBUG_DISPLAY` must be `false`. With `WP_DEBUG` off, WordPress doesn't touch PHP's error settings at all, so the server's PHP configuration is what protects the site: `display_errors = Off`, `log_errors = On`, and `error_log` pointing outside the web root.
- **Take the settings from the environment, never hardcode them.** `.wp-env.json` is a local development file and must not be reused for hosting. On a server, set the values as environment variables and read them in `wp-config.php`, so the same code runs everywhere and a debug setting can't be committed by accident:

  ```php
  // wp-config.php: debugging stays off unless the environment turns it on,
  // and errors are never displayed either way.
  define( 'WP_DEBUG', 'true' === getenv( 'WP_DEBUG' ) );
  define( 'WP_DEBUG_DISPLAY', false );
  define( 'WP_DEBUG_LOG', getenv( 'WP_DEBUG_LOG_PATH' ) ?: false ); // e.g. /var/log/wordpress/errors.log
  ini_set( 'display_errors', '0' ); // Also when WP_DEBUG is off, which WordPress leaves to php.ini.
  ```

- **Log outside the web root.** Point PHP's `error_log` (and `WP_DEBUG_LOG`, when debugging is on) at a directory the web server doesn't serve, such as `/var/log/...`. Never use `WP_DEBUG_LOG = true`, which writes to the web-served `wp-content/debug.log`.
- **Keep the plugin's own responses generic.** The REST API already returns fixed error codes and messages (see [`api.md`](api.md)), never exception text. Keep it that way for new endpoints.
