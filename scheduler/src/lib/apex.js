/**
 * Apex Tools AI public API wrappers.
 *
 * The blog backend lives at https://apextoolsai.com/api/posts and uses
 * Bearer-token auth on mutating routes (POST/PATCH).
 *
 * Schema (subset we use):
 *   POST /api/posts        { title, slug?, excerpt, content, cover_image_url, author_name,
 *                            tag, language, status, seo_title, seo_description }
 *   GET  /api/posts        → { posts: [...], total }
 *   GET  /api/posts/{slug} → single post (published only for unauth)
 *   PATCH /api/posts/{id}  { status: "published"|"draft"|"archived", ...editable fields }
 */

export async function listPosts(env, { limit = 100 } = {}) {
  const url = new URL(env.APEX_API_BASE + "/posts");
  if (limit) url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`GET /api/posts ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.posts || [];
}

export async function getPost(env, slugOrId) {
  const res = await fetch(`${env.APEX_API_BASE}/posts/${encodeURIComponent(slugOrId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /api/posts/${slugOrId} ${res.status}: ${await res.text()}`);
  return await res.json();
}

export async function createPost(env, payload) {
  const res = await fetch(env.APEX_API_BASE + "/posts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + env.APEX_API_TOKEN,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`POST /api/posts ${res.status}: ${txt.slice(0, 400)}`);
  }
  return await res.json();
}

export async function patchPost(env, idOrSlug, patch) {
  const res = await fetch(`${env.APEX_API_BASE}/posts/${encodeURIComponent(idOrSlug)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + env.APEX_API_TOKEN,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`PATCH /api/posts/${idOrSlug} ${res.status}: ${txt.slice(0, 400)}`);
  }
  return await res.json();
}

// Used by article handlers to avoid republishing a title that already exists.
export function titleAlreadyExists(existingPosts, candidateTitle) {
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
  const target = norm(candidateTitle);
  return existingPosts.some(p => norm(p.title) === target);
}
