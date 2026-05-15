/**
 * Apex Tools AI — Cron Scheduler Worker
 *
 * Entry point. Cloudflare invokes `scheduled()` once per minute that matches
 * one of the cron expressions in wrangler.toml. We route on `event.cron`
 * (the literal cron string) to one of 5 handlers:
 *
 *   "5 13 * * 2"  → publishTuesdayArticle
 *   "5 13 * * 4"  → publishThursdayArticle
 *   "0 10 * * *"  → dailyQaSweep
 *   "5 21 * * 0"  → sundayRecap
 *
 * Each handler:
 *   1. Loads its prompt template from src/prompts/*.md
 *   2. Calls Claude with current context (today's date, existing post titles)
 *   3. Acts on the result (POST /api/posts, PATCH /api/posts/{id}, email)
 *   4. Notifies Albert via email on success or failure
 *
 * Also exposes a fetch() handler so we can manually trigger a cron via
 *   curl -X POST <worker-url>/__manual?cron=5+13+*+*+2
 * (Requires header `X-Admin-Token` matching env.APEX_API_TOKEN.)
 */

import {
  publishTuesdayArticle,
  publishThursdayArticle,
} from "./lib/articles.js";
import { dailyQaSweep } from "./lib/qa.js";
import { sundayRecap } from "./lib/recap.js";
import { notifyError } from "./lib/notify.js";

const CRON_ROUTES = {
  "5 13 * * 2": { name: "tuesday-article",      handler: publishTuesdayArticle },
  "5 13 * * 4": { name: "thursday-article",     handler: publishThursdayArticle },
  "0 10 * * *": { name: "daily-qa-sweep",       handler: dailyQaSweep },
  "5 21 * * 0": { name: "sunday-recap",         handler: sundayRecap },
};

export default {
  async scheduled(event, env, ctx) {
    const route = CRON_ROUTES[event.cron];
    if (!route) {
      console.log(`[scheduler] unmapped cron: ${event.cron}`);
      return;
    }
    console.log(`[scheduler] firing ${route.name} @ ${new Date(event.scheduledTime).toISOString()}`);
    try {
      const result = await route.handler({ env, ctx });
      console.log(`[scheduler] ${route.name} ok:`, JSON.stringify(result).slice(0, 500));
    } catch (err) {
      console.error(`[scheduler] ${route.name} failed:`, err.stack || err.message);
      // Best-effort email; swallow secondary failures.
      ctx.waitUntil(notifyError(env, route.name, err).catch(() => {}));
      throw err;
    }
  },

  // Manual trigger endpoint — useful for first deploy verification.
  // POST /__manual?cron=5+13+*+*+2  with header X-Admin-Token: <APEX_API_TOKEN>
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(
        JSON.stringify({
          name: "apextoolsai-scheduler",
          status: "running",
          crons: Object.keys(CRON_ROUTES),
        }, null, 2),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === "/__manual" && request.method === "POST") {
      const token = request.headers.get("x-admin-token");
      if (token !== env.APEX_API_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      const cron = url.searchParams.get("cron");
      const route = CRON_ROUTES[cron];
      if (!route) {
        return new Response(
          JSON.stringify({ error: "unknown cron", available: Object.keys(CRON_ROUTES) }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
      console.log(`[manual] firing ${route.name}`);
      try {
        const result = await route.handler({ env, ctx });
        return new Response(JSON.stringify({ ok: true, name: route.name, result }, null, 2), {
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ ok: false, name: route.name, error: err.message, stack: err.stack }, null, 2),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }
    }

    return new Response("not found", { status: 404 });
  },
};
