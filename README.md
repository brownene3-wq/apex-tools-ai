# Apex Tools AI — Marketing Website

Bilingual marketing website for Apex Tools AI, an agency selling AI phone receptionists and chatbots to South Florida professional practices.

**Live site:** https://apextoolsai.com (English) / https://apextoolsai.com/es/ (Spanish)

---

## Stack

- **Framework:** Static HTML + Tailwind CSS (via CDN)
- **Hosting:** Cloudflare Pages
- **DNS:** Cloudflare (apextoolsai.com)
- **Source control:** GitHub (`brownene3-wq/apex-tools-ai`)
- **Icons:** Lucide
- **Fonts:** Google Fonts (Inter + Plus Jakarta Sans)

No build step. No npm install. Just static HTML files served directly.

---

## File Structure

```
apex-tools-ai/
├── index.html              # English homepage (/)
├── es/
│   └── index.html          # Spanish homepage (/es/)
├── _headers                # Cloudflare Pages security & cache headers
├── _redirects              # Cloudflare Pages redirect rules
├── robots.txt              # SEO crawler directives
├── sitemap.xml             # SEO sitemap (with hreflang for bilingual)
├── .gitignore
└── README.md               # This file
```

---

## Branch Workflow (matches Albert's standard 3-environment convention)

| Branch | Environment | URL |
|---|---|---|
| `main` | Production | https://apextoolsai.com |
| `staging` | Staging | https://staging.apextoolsai.com (set up later) |
| `dev` | Development | https://dev.apextoolsai.com (set up later) |

For now, only `main` is deployed. Staging and dev are pre-provisioned for the same convention as RepurposeAI.

### Standard fix workflow

1. **Fix on dev** — `git checkout dev && git pull && [edit files] && git commit -am "Fix XYZ" && git push origin dev`
2. **Promote to staging** — `git checkout staging && git pull && git merge dev --no-edit && git push origin staging`
3. **Deploy to production** — `git checkout main && git pull && git merge staging --no-edit && git push origin main`
4. **Switch back** — `git checkout dev`

Skip dev/staging for trivial copy edits — push directly to `main` if it's a typo fix or content tweak.

---

## How to Edit Common Things

### Update copy text
Open `index.html` (English) or `es/index.html` (Spanish). All copy is plain text inside HTML elements. Find the text you want to change, edit, save, commit, push.

### Update pricing
Search for `$2,500`, `$400`, `$1,000`, etc. in both `index.html` and `es/index.html`. Update both files when changing prices.

### Update demo phone number
Search for `+19549999999` and `(954) 999-9999` in both files. Replace with the real Twilio demo number once provisioned.

### Update Calendly link
Search for `https://calendly.com/apextoolsai/discovery` in both files. Replace with the real Calendly URL.

### Add a new FAQ
Find the FAQ `<section id="faq">` in both files. Copy an existing `<details>` block, paste, edit the question and answer.

### Change the brand colors
The accent color is defined in the `tailwind.config` block at the top of each HTML file. Change `accent-500` (`#f97316`) and the others to update the orange. Change `navy-900` (`#0a1628`) to update the dark navy.

### Add a new section
Copy any existing `<section>` block as a template. Sections use Tailwind utility classes for layout. The `reveal` class on child elements triggers the scroll-in animation.

---

## Cloudflare Pages Setup (one-time)

1. Log into Cloudflare dashboard: https://dash.cloudflare.com/
2. Go to **Pages** in the left sidebar
3. Click **Create a project** → **Connect to Git** → select GitHub
4. Authorize Cloudflare to access the `apex-tools-ai` repo
5. Configure:
   - **Project name:** `apex-tools-ai`
   - **Production branch:** `main`
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** *(leave as `/`)*
   - **Root directory:** *(leave empty)*
6. Click **Save and Deploy**
7. Once deployed, go to **Custom domains** → add `apextoolsai.com` and `www.apextoolsai.com`
8. Cloudflare auto-configures DNS since the domain is on the same Cloudflare account

---

## SEO Notes

- Both language versions have proper `lang="en"` / `lang="es"` attributes
- Meta tags optimized for the target audience (South Florida dental/med spa owners)
- `sitemap.xml` includes `hreflang` tags for proper bilingual indexing
- Schema.org `LocalBusiness` markup should be added once first office address is finalized
- Consider adding Google Search Console verification once deployed

---

## Things to Add Later

- Real demo phone number (replace placeholder `(954) 999-9999`)
- Real Calendly link (replace placeholder `calendly.com/apextoolsai/discovery`)
- Loom demo video embed (currently placeholder in demo section)
- Real testimonials (replace fictional Dr. María González with first 3 real client quotes)
- Client logos strip (after first 5 clients)
- Privacy & Terms pages (footer links currently go to `#`)
- Google Analytics / Plausible tracking
- Schema.org LocalBusiness markup with real address
- OpenGraph image (1200x630) for social sharing

---

## License

Proprietary. © 2026 Apex Tools AI. All rights reserved.
