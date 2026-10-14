# Supabase account deletion deployment

This Edge Function is **not deployed automatically** when committed to GitHub.

1. In your Supabase project, deploy the `delete-account` Edge Function using Supabase CLI or the Functions dashboard.
2. Ensure the function has access to `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` via **server-side secrets only**. Never paste a service-role key in GitHub or the public site.
3. Keep JWT verification enabled (the function also independently checks the supplied session with `auth.getUser`).
4. Test deletion with a disposable account containing posts, comments, reports, blocks and images; verify authentication is removed as well as storage objects.
5. Confirm database policies, table names and referential actions match the function. If your database differs, adjust the function before enabling deletion.
6. In the website `config.js`, set `ACCOUNT_DELETION_ENABLED: true` only after successful deployment and testing. Leave it false or omitted until then.

Caution: the operation is irreversible and can partially complete if the database/storage service fails during deletion. In that event, investigate server logs and process the user's request manually.
