// Deploy with Supabase CLI: supabase functions deploy delete-account
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server environment.
// Never put the service-role key in config.js or other client files.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: object) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return reply(503, { error: 'Deletion service not configured' });
    const token = req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return reply(401, { error: 'Sign in required' });
    const body = await req.json().catch(() => ({}));
    if (body.confirm !== 'DELETE MY ACCOUNT') return reply(400, { error: 'Confirmation missing' });
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return reply(401, { error: 'Session expired. Sign in again.' });
    const id = user.id;
    const check = (result: { error?: { message: string } | null }, label: string) => {
      if (result.error) throw new Error(label + ': ' + result.error.message);
    };
    // Gather files and posts before deleting database records.
    const posts = await admin.from('posts').select('id,image_path').eq('user_id', id);
    check(posts, 'Read posts');
    const ids = (posts.data || []).map((p: {id:string}) => p.id);
    // Delete interactions involving own posts first to avoid orphaned references.
    for (const postId of ids) {
      check(await admin.from('comments').delete().eq('post_id', postId), 'Remove post comments');
      check(await admin.from('likes').delete().eq('post_id', postId), 'Remove post likes');
      check(await admin.from('reports').delete().eq('post_id', postId), 'Remove post reports');
    }
    check(await admin.from('comments').delete().eq('user_id', id), 'Remove comments');
    check(await admin.from('likes').delete().eq('user_id', id), 'Remove likes');
    check(await admin.from('reports').delete().eq('reporter_id', id), 'Remove reports');
    check(await admin.from('blocks').delete().eq('blocker_id', id), 'Remove blocks');
    check(await admin.from('blocks').delete().eq('blocked_id', id), 'Remove blocked relationships');
    check(await admin.from('posts').delete().eq('user_id', id), 'Remove posts');
    check(await admin.from('profiles').delete().eq('id', id), 'Remove profile');
    const paths = (posts.data || []).map((p: {image_path:string|null}) => p.image_path).filter(Boolean) as string[];
    // Remove uploads under the user's own folder, even if a post was deleted earlier.
    const listing = await admin.storage.from('post-images').list(id, { limit: 1000 });
    check(listing, 'List account photos');
    const listed = (listing.data || []).filter((p: {name:string}) => p.name && !p.name.startsWith('.')).map((p: {name:string}) => id + '/' + p.name);
    const all = [...new Set([...paths, ...listed])];
    if (all.length) check(await admin.storage.from('post-images').remove(all), 'Remove account photos');
    const deleted = await admin.auth.admin.deleteUser(id);
    check(deleted, 'Remove authentication account');
    return reply(200, { success: true });
  } catch (e) {
    console.error('Deletion failed:', e);
    return reply(500, { error: 'Account deletion could not be completed. Contact support to finish the request.' });
  }
});
