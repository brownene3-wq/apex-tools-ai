import { clearSessionCookie } from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/apex_session=([^;]+)/);
  if (m && env.DB) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(m[1]).run();
  }
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/login.html',
      'Set-Cookie': clearSessionCookie(),
    },
  });
}

export const onRequestGet = onRequestPost;
