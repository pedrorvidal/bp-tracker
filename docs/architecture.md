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
