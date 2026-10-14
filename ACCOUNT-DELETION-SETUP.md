# Supabase account deletion deployment

This Edge Function is **not deployed automatically** when committed to GitHub.

1. In your Supabase project, deploy the `delete-account` Edge Function using Supabase CLI or the Functions dashboard.
2. Ensure the function has access to `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` via **server-side secrets only**. Never paste a service-role key in GitHub or the public site.
3. Keep JWT verification enabled (the function also independently checks the supplied session with `auth.getUser`).
4. Test deletion with a disposable account containing posts, comments, reports, blocks and images; verify authentication is removed as well as storage objects.
5. Confirm database policies, table names and referential actions match the function. If your database differs, adjust the function before enabling deletion.
6. In the website `config.js`, set `ACCOUNT_DELETION_ENABLED: true` only after successful deployment and testing. Leave it false or omitted until then.

Caution: the operation is irreversible and can partially complete if the database/storage service fails during deletion. In that event, investigate server logs and process the user's request manually.

## Updated function (October 14, 2026)

The current GitHub function requires an access token issued in the last 10 minutes. The user should sign out and sign back in immediately before confirming deletion. Do not turn on `ACCOUNT_DELETION_ENABLED` until the new function has been deployed and a disposable-account test succeeds. The operation may partially complete across Auth, database and Storage; inspect Edge Function logs and manually complete deletion if needed.

For release readiness, check that profile deletion cascades to posts/comments/likes/blocks and that the service-role credential remains in Supabase server secrets. Never place it in `config.js`.
