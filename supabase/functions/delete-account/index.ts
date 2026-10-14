import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers });
type DbResult = { error: { message: string } | null };
function checked(result: DbResult, step: string) {
  if (result.error) throw new Error(step + ': ' + result.error.message);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });

  let phase = 'validation';
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return reply(503, { error: 'Deletion service not configured' });

    const jwt = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!jwt) return reply(401, { error: 'Sign in required' });
    const input = await req.json().catch(() => null);
    if (input?.confirm !== 'DELETE MY ACCOUNT')
      return reply(400, { error: 'Confirmation missing' });

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const auth = await admin.auth.getUser(jwt);
    if (auth.error || !auth.data.user)
      return reply(401, { error: 'Session invalid. Sign in again.' });
    const id = auth.data.user.id;

    // Require a recently issued user access token (not the public anon token).
    // Fresh login is needed if the current access token was issued > 10 minutes ago.
    const payloadSegment = jwt.split('.')[1];
    if (!payloadSegment) return reply(401, { error: 'Invalid access token' });
    let claims: { sub?: string; iat?: number };
    try {
      const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      claims = JSON.parse(atob(base64));
    } catch {
      return reply(401, { error: 'Invalid access token' });
    }
    const now = Math.floor(Date.now() / 1000);
    if (claims.sub !== id || !Number.isFinite(claims.iat) ||
        now - Number(claims.iat) > 600 || Number(claims.iat) > now + 60) {
      return reply(403, { error: 'For security, please sign out and sign in again before deleting your account.' });
    }

    // Preflight: list all account posts and every file in its dedicated directory
    // BEFORE deleting anything, so a listing error cannot cause partial removal.
    const postIds: string[] = [];
    const photoPaths = new Set<string>();
    for (let offset = 0; ; offset += 500) {
      const r = await admin.from('posts').select('id,image_path')
        .eq('user_id', id).order('id', { ascending: true }).range(offset, offset + 499);
      checked(r, 'Read posts');
      const data = r.data || [];
      for (const p of data) {
        postIds.push(p.id);
        if (p.image_path) {
          if (!p.image_path.startsWith(id + '/')) throw new Error('Unexpected photo ownership path');
          photoPaths.add(p.image_path);
        }
      }
      if (data.length < 500) break;
    }
    for (let offset = 0; ; offset += 100) {
      const r = await admin.storage.from('post-images').list(id, {
        limit: 100, offset, sortBy: { column: 'name', order: 'asc' },
      });
      checked(r, 'List uploads');
      const entries = r.data || [];
      for (const item of entries) {
        if (item.name && item.id) photoPaths.add(id + '/' + item.name);
      }
      if (entries.length < 100) break;
    }

    // Supabase does not provide a single transaction across Storage and Auth.
    // Failures after this point may require manual follow-up. Errors are logged.
    phase = 'remove storage';
    const paths = [...photoPaths];
    for (let i = 0; i < paths.length; i += 100) {
      checked(await admin.storage.from('post-images').remove(paths.slice(i, i + 100)),
        'Remove photos');
    }

    phase = 'remove database';
    // Database foreign-key CASCADE handles likes/comments/blocks related to
    // removed profiles/posts. Explicitly remove reports of own posts first.
    for (const postId of postIds) {
      checked(await admin.from('reports').delete().eq('post_id', postId), 'Remove post reports');
    }
    checked(await admin.from('profiles').delete().eq('id', id), 'Remove profile and related records');

    phase = 'remove authentication';
    checked(await admin.auth.admin.deleteUser(id), 'Remove authentication account');

    return reply(200, { success: true });
  } catch (error) {
    console.error('Account deletion error, phase:', phase, error);
    return reply(500, {
      error: 'Deletion could not be completed. Please contact ridegarageapp@gmail.com for assistance.',
    });
  }
});
