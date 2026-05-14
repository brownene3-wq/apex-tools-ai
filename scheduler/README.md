# apextoolsai-scheduler

Cloudflare Worker that runs the 5 scheduled jobs for apextoolsai.com's blog:

| Cron (UTC)       | ET equivalent    | Task                                 |
|------------------|------------------|--------------------------------------|
| `5 13 * * 2`     | Tue 9:05 AM ET   | Tuesday SEO article                  |
| `5 13 * * 4`     | Thu 9:05 AM ET   | Thursday case-study article          |
| `5 13 * * 6`     | Sat 9:05 AM ET   | Saturday competitive comparison      |
| `0 10 * * *`     | Daily 6:00 AM ET | QA sweep — unpublishes bad posts     |
| `5 21 * * 0`     | Sun 5:05 PM ET   | Weekly recap email to Albert         |

> Note: Cron triggers run in UTC. The chosen times are EDT-aligned (UTC-4). During EST (Nov-Mar) they fire 1 hour earlier in local time. If precise year-round 9:05 AM ET is needed, we can add DST-aware logic later.

## Architecture

```
scheduler/
├── wrangler.toml          # cron triggers + bindings
├── package.json           # wrangler dev dep
└── src/
    ├── index.js           # scheduled() + fetch() entry — routes by event.cron
    ├── lib/
    │   ├── anthropic.js   # Claude API wrapper (text + JSON modes)
    │   ├── apex.js        # POST/GET/PATCH /api/posts wrapper
    │   ├── resend.js      # transactional email
    │   ├── notify.js      # success/error/recap email helpers
    │   ├── articles.js    # the 3 article handlers (share one pipeline)
    │   ├── qa.js          # daily QA sweep
    │   └── recap.js       # Sunday recap
    └── prompts/
        ├── tuesday-article.md
        ├── thursday-article.md
        ├── saturday-comparison.md
        ├── daily-qa.md
        └── sunday-recap.md
```

Prompts live in `*.md` files (bundled as text imports via wrangler `[[rules]] type = "Text"`). Iterating a prompt = edit the file, commit, push → auto-deploys via GitHub Actions in ~60s.

## One-time setup (do this once)

In GitHub repo settings → Secrets and variables → Actions → New repository secret, add:

| Secret name              | Where to get it                                                                 |
|--------------------------|----------------------------------------------------------------------------------|
| `CLOUDFLARE_API_TOKEN`   | Cloudflare dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID`  | Cloudflare dashboard → Workers & Pages → right sidebar                          |
| `ANTHROPIC_API_KEY`      | console.anthropic.com → Settings → API Keys                                     |
| `APEX_API_TOKEN`         | `apx_91fb6b7bd3026d820d87aec4d4bed54e82a6dec1` (already provisioned)            |
| `RESEND_API_KEY`         | The same key used by Cloudflare Pages for `RESEND_API_KEY` (transactional)      |

Once those 5 secrets exist, every push to `main` that touches `scheduler/**` auto-deploys.

## Manual deploy (alternative)

```bash
cd scheduler
npm install
npx wrangler login                # one-time browser auth
npx wrangler secret put ANTHROPIC_API_KEY   # paste when prompted
npx wrangler secret put APEX_API_TOKEN
npx wrangler secret put RESEND_API_KEY
npx wrangler deploy
```

## Testing

After deploy, the worker exposes a manual-trigger endpoint:

```bash
WORKER_URL=https://apextoolsai-scheduler.<your-subdomain>.workers.dev

# Hit the root to confirm it's running:
curl $WORKER_URL

# Fire one cron manually (uses APEX_API_TOKEN as a bearer):
curl -X POST "$WORKER_URL/__manual?cron=5+13+*+*+2" \
     -H "x-admin-token: apx_91fb6b7bd3026d820d87aec4d4bed54e82a6dec1"
```

The Tuesday article cron will run the full pipeline (Claude → validate → POST /api/posts → email Albert). Returns JSON with the slug, URL, and word count.

Use `npx wrangler tail` to stream live logs while testing.

## Iterating prompts

Edit any file in `src/prompts/`, commit, push. GitHub Actions deploys in ~60s. Next scheduled run uses the new prompt — no infrastructure changes.

## Cost

- Cloudflare Workers free tier: 100,000 requests/day. We use ~7/week.
- Anthropic Claude Sonnet: ~$3-5/month at 12 articles + 30 daily-QA runs + 4 recaps.
- Resend: free tier covers our email volume.
