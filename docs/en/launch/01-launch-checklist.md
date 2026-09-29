# Launch Checklist — your own Premium catalog business

Everything needed to take this fork from "working code" to "charging money".
Work top to bottom; anything unchecked blocks revenue or trust.

> **$0 launch?** No domain / no card / Stripe doesn't serve your country?
> Sections 2–3 have an alternate **Plan $0**: Render free hosting (real TLS
> subdomain), USDT/PayPal manual checkout (`CHECKOUT_MODE=manual`), SendGrid
> freemail delivery, and GitHub-repo state backup. See "Plan $0" callouts
> below and `catalog/README.md → Launch for $0/month`.

## 0 · Legal posture (30 min)

## 0 · Legal posture (30 min)

- [ ] **Keep `./LICENSE` as-is.** MIT requires the original copyright (Tashfeen Ahmed) to stay. Your additions are covered by the same file.
- [ ] **Keep `./NOTICE`.** It states the fork relationship plainly — cheap insurance against "you stole it" drama, and honest marketing.
- [ ] **Pick a name that is not "FreeLLMAPI"** and a domain that is not `freellmapi.co`. The upstream brand/site/feed belong to the upstream author. Confusion here is the one move that could get your launch publicly torched.
- [ ] The storefront at `/` already serves `/terms`, `/privacy`, `/refunds` (rendered from your `BRAND_*` env). Read them once; adjust wording to your jurisdiction (sell from your country → know your digital-goods invoicing duties).
- [ ] Never imply the app *includes* LLM inference. You sell a **catalog update feed**. Providers' free tiers remain bound by each provider's ToS (the terms page says so).

## 1 · Brand (15 min, once decided)

- [ ] `server/src/lib/brand.ts` → set your real `https://api.<domain>` and `https://<domain>`.
- [ ] `catalog/.env` → `BRAND_NAME`, `BRAND_DOMAIN`, `SITE_URL`, `SUPPORT_EMAIL`, `GITHUB_URL`.
- [ ] Sweep the fork README: replace upstream store badges/links (`freellmapi.co`, App Store / Play links, tashfeenahmed URLs) with yours. The README is your #1 landing page on GitHub.

## 2 · Catalog service deploy (≈1 h)

**Plan $0 variant:** Render → New → Blueprint → pick this repo (`render.yaml`
is at the root). After first deploy, set in the dashboard: `BRAND_*`,
`SITE_URL=https://<name>.onrender.com`, `CHECKOUT_MODE=manual`, `PAY_*`,
`ADMIN_TOKEN` (generate: `openssl rand -hex 24`), `SENDGRID_API_KEY`,
`EMAIL_FROM`, `BACKUP_GITHUB_REPO` (create it PRIVATE first) + PAT, and
`BACKUP_GITHUB_TOKEN`. Health: `https://<name>.onrender.com/healthz` → ok.
Render's `*.onrender.com` subdomain **is** your brand domain until money says
otherwise — put it everywhere the app/docs mention your site.

Follow `catalog/README.md` end to end. Short version:

- [ ] `npm run keygen -w catalog` → pin pubkey already done in this repo; **back up `CATALOG_PRIVKEY` now** (password manager + 1 offline copy).
- [ ] Docker image → your host, `/data` volume attached.
- [ ] DNS → TLS live. `curl https://<domain>/healthz` → `{"ok":true,…}`.
- [ ] Daily cron: back up `/data/licenses.db` (one file) to object storage.
- [ ] Uptime monitor on `/healthz` (UptimeRobot free tier is fine). If the feed dies, *every* router still works on its last catalog — degraded, not down. That's a selling point, mention it.

## 3 · Payments (≈20 min, then first real $)

**Plan $0 variant (no Stripe):** set `CHECKOUT_MODE=manual` + `PAY_USDT_ADDRESS`
(TronLink/Binance, TRC20 has $1 fees) and/or `PAY_PAYPAL_URL` (`paypal.me/you`
— works with Venezuelan-verified accounts; Zinli/Wally also fine via `PAY_NOTE`).
Your operator loop is 3 commands (see `catalog/README.md`); the buyer flow is
fully self-serve until the confirm step. When revenue ≥ ~$20: register a
domain, open a processor reachable from VE (Lemon Squeezy / Hotmart / crypto
aggregator — verify VE payout eligibility first), flip `CHECKOUT_MODE`.

- [ ] Live-mode products + prices; env `STRIPE_PRICE_ANNUAL`, `STRIPE_PRICE_LIFETIME`.
- [ ] Webhook (live) → 5 events listed in `catalog/README.md`; env `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- [ ] Billing portal enabled (cancel / card update / invoices).
- [ ] Statement descriptor set (what shows on card statements — use your brand).
- [ ] Business verification + payout bank account (Stripe requirement to withdraw).
- [ ] Decide on Stripe Tax (digital subscriptions are taxable in many jurisdictions; Stripe Tax automates it ~0.5%/tx).
- [ ] **Full test-mode dry run**: buy → key on `/success` + email → paste key in router → live tier. Then cancel in portal → key reason `canceled` path verified.

## 4 · The product cadence (this is what renewals pay for)

- [ ] Calendar it, non-negotiable: **live catalog refresh every 2–3 days**, **monthly snapshot promote every ~30 days**. Publish = export → sign → copy to `/data` (see `catalog/README.md` "Publishing flow").
- [ ] Watch sources: provider changelogs/discords, new free-tier announcements, quota change posts. Start with the 34 providers the README lists.
- [ ] Consider a public `catalog-changelog` page later — visible proof of the cadence IS the marketing.

## 5 · App release (the free funnel)

- [ ] Point checks: app boots, syncs against YOUR domain (log line `[catalog-sync] polling https://api.<domain>`), applies the seed `2026.09.28` (≥ `MIN_CATALOG_VERSION` — it is).
- [ ] `npm test`, `npm run lint`, `npm run build` all green → GitHub release (Docker image + binaries per repo CI).
- [ ] README quickstart must get a stranger to a working `curl localhost:.../v1/chat/completions` in <10 minutes — that funnel feeds premium.

## 6 · Launch day (Tue/Wed/Thu)

- [ ] Demo: 60–90s screen capture — add 3 free keys → ask Claude Code a question → router fails over live → dashboard shows budget. GIF in README.
- [ ] Show HN ("free LLM tiers, one OpenAI endpoint; I sell the catalog feed"), r/LocalLLaMA, r/selfhosted, X/Twitter thread, Product Hunt (schedule 00:01 PT).
- [ ] Be upfront it's an independent fork with its own feed — honesty inoculates, hiding it detonates later.
- [ ] First-week pricing tactic: lifetime $79 capped "first 100 buyers" counter. Urgency without discounts.

## 7 · Money metrics to watch weekly

| Metric                        | Where it shows |
| ----------------------------- | -------------- |
| Checkouts started/succeeded   | Stripe dashboard |
| Keys activated (routers live) | count `licenses` rows with recent `/v1/license/check` (add an ops query later) |
| MRR & churn                   | Stripe → Subscriptions |
| Refund rate (14-day window)   | Stripe → Disputes/Refunds |
| Feed freshness                | `/healthz` versions vs today |

## 8 · Known follow-ups (not blockers)

- Catalog seed covers the **bundled** baseline (110 chat models / 16 platforms); growing it toward the "635 endpoints" the upstream marketing cites is exactly the editorial work above. Extend `export-catalog.ts` to also emit `embeddings`/`transcriptionModels`/`videoModels` sections when your DB holds them (the router already ingests those keys).
- Spanish storefront variant (huge underserved market for selfhosting content).
- Stripe Tax / Paddle switch if VAT handling grows painful.
- `catalog/` eslint config + migration to `node:sqlite` once Node 24 prebuilds make better-sqlite3 optional.
