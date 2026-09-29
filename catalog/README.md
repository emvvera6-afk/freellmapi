# Catalog + Licensing Service

The revenue backend for this fork. The router app is free and open source;
**this service is the product people pay for**: the continuously-updated,
Ed25519-signed model catalog (live tier), plus license keys, Stripe billing,
and the storefront site — all in one small Node process with a SQLite file.

```
┌─────────────┐   GET /v1/latest (Bearer? → live : monthly;  signed bytes + x-catalog-signature)
│  Router app │ ─ POST /v1/license/activate · GET /v1/license/check · POST /v1/portal
│ (user's PC) │
└─────────────┘
       ▲
│ YOUR domain: this service
├─────────────┐
│ catalog/    │  /              storefront (pricing, FAQ, terms)
│  · feed     │  /recover       key recovery (rotation by email)
│  · licenses │  /success       post-checkout: shows the key instantly
│  · stripe   │  /v1/checkout · /v1/webhooks/stripe · /v1/portal
└─────────────┘
       ▲ Stripe webhooks fulfill purchases → license key issued + emailed
```

## Table of endpoints

| Method & path                  | Purpose                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| `GET  /healthz`                | Liveness + published versions (503 until both tiers are signed)|
| `GET  /v1/latest?since=v`      | Signed catalog. `Authorization: Bearer <key>` → **live**, else **monthly**. 304 when `since` matches the tier. |
| `POST /v1/license/activate`    | `{key}` → `{valid, plan, status, expiresAt, reason?}` (always 200) |
| `GET  /v1/license/check`       | Same payload, key via `Authorization: Bearer`                  |
| `POST /v1/checkout`            | `{plan: annual\|lifetime}` → Stripe Checkout URL               |
| `GET  /v1/checkout/session?id` | Success page: `{issued, key?}` (plaintext key, 15-min TTL)     |
| `POST /v1/portal`              | `{key}` → Stripe Billing Portal URL (cancel/card/invoices)     |
| `POST /v1/key/recover`         | `{email}` → rotates + emails replacement keys (silent 200)     |
| `POST /v1/webhooks/stripe`     | Fulfillment + lifecycle. Raw-body, signature-verified, idempotent |

## First-time setup (done once, ever)

```bash
npm install                       # from the repo root
npm run keygen -w catalog         # writes CATALOG_PRIVKEY to catalog/.env, prints the PUBLIC key
# → paste the public key as PINNED_CATALOG_PUBKEY in server/src/services/catalog-sync.ts
#   (already done in this fork — repeat only if you rotate keys)

# Build the catalog products from your router DB (source of truth):
npm run export-catalog -w server -- --tier live --out catalog/data/catalog.live.json
npm run promote-monthly -w catalog   # live → monthly snapshot
npm run sign -w catalog              # writes *.sig sidecars

npm run dev -w catalog            # http://localhost:8780  (degraded Stripe mode is fine locally)
npm run test -w catalog           # protocol, license and billing suites
```

## Launch for $0/month (no domain, no Stripe, no card)

The service grows down: everything above also runs on free infrastructure.

| Piece | $0 option | Env |
| --- | --- | --- |
| Hosting + TLS | **Render free** — Blueprint reads `render.yaml` (repo root); your URL is `https://<name>.onrender.com`. Sleeps when idle (fine: router polls retry), disk is ephemeral (see BACKUP_*) | `SITE_URL=https://<name>.onrender.com` |
| Payments | **Manual mode** — buyers order on `/buy`, you confirm USDT/PayPal and run one `curl` to issue + email the key. Zero fees, zero KYC, works from Venezuela | `CHECKOUT_MODE=manual`, `PAY_USDT_ADDRESS`, `PAY_PAYPAL_URL`, `ADMIN_TOKEN` |
| Email | **SendGrid free** (100/day) with single-sender verification on a Gmail address (no sending domain required) | `SENDGRID_API_KEY`, `EMAIL_FROM=Tienda <you@gmail.com>` |
| State durability | **GitHub backup** — `licenses.db` pushes (debounced) to a private repo and restores on boot, surviving Render's ephemeral disk | `BACKUP_GITHUB_REPO`, `BACKUP_GITHUB_TOKEN` |

Manual ops loop (the 60 seconds a sale costs you):

```bash
# 1. You get an email: "[order] ORD-XYZ — annual $19 — buyer@x.com (usdt)"
# 2. Buyer sends txid; you verify on Tronscan / PayPal
# 3. Issue + email the key in one shot (idempotent):
curl -X POST https://<name>.onrender.com/v1/admin/orders/ORD-XYZ/fulfill \
     -H "Authorization: Bearer $ADMIN_TOKEN"
# Watch pending orders:  curl -H "Authorization: Bearer $ADMIN_TOKEN" \
#   "https://<name>.onrender.com/v1/admin/orders?status=pending"
```

Upgrade path keeps 100% of the code: buy a domain when revenue ≥ $20, set
Stripe keys + `CHECKOUT_MODE=stripe`, flip DNS — buyers never notice.


**Back up `catalog/.env` (the `CATALOG_PRIVKEY` line) in your password
manager.** It signs every catalog. Losing it = rotate keypair + ship a new
app release. Leaking it = attackers can feed models to your users.

## Stripe setup (≈20 min)

1. **Products**: create two — e.g. "Premium — Annual" (recurring, yearly, $19) and
   "Premium — Lifetime" (one-time, $79). Copy each **Price ID** (`price_…`)
   into `STRIPE_PRICE_ANNUAL` / `STRIPE_PRICE_LIFETIME`.
2. **Webhook**: Developers → Webhooks → Add endpoint:
   `https://<your-domain>/v1/webhooks/stripe`
   Events: `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`, `charge.refunded`.
   Copy the **Signing secret** to `STRIPE_WEBHOOK_SECRET`.
3. **Billing portal**: Settings → Billing → Customer portal → activate with
   *cancel subscription*, *update payment method*, *invoice history* enabled.
4. **`STRIPE_SECRET_KEY`** from Developers → API keys.
5. Test the loop in **test mode** with card `4242 4242 4242 4242`:
   buy on your landing → see the key on `/success` **and** in your inbox →
   paste it into the router (Settings → Premium) → catalog flips to **live**.

`PRICE_ANNUAL_USD` / `PRICE_LIFETIME_USD` are display-only strings for the
landing; the real amounts are the Stripe prices.

## Email (Resend)

Create an API key at [resend.com](https://resend.com), verify your sending
domain, set `RESEND_API_KEY` and `EMAIL_FROM`. Without it, license emails are
logged to stdout — fine for dev, unacceptable in prod.

## Deploy

Any Docker host works. The image encloses code; **state lives on the `/data`
volume** (`licenses.db` + the signed catalog products you publish).

```bash
docker build -f catalog/Dockerfile -t ghcr.io/<you>/catalog .
docker run -d --restart unless-stopped -p 8780:8780 \
  -v catalog-data:/data --env-file catalog/.env ghcr.io/<you>/catalog
```

DNS: point your domain (both `@` and `api.` if you split services) at the
host, terminate TLS (Caddy/Traefik/your PaaS does it). Then set in the
deployed `.env`: `SITE_URL=https://<domain>`, `BRAND_*`, Stripe, Resend.

Backups: snapshot `/data/licenses.db` daily (it's one file — `sqlite3 .backup`
or a `cp` cron to object storage). Losing it = you can still recover keys on
request via rotation, but you lose subscription bookkeeping; Stripe remains
the billing source of truth and can re-derive customers.

## Publishing flow (the job you're selling)

```bash
# 1. Track providers (new models / retirements / quotas) and update your
#    router DB, or hand-edit catalog/data/catalog.live.json directly
#    (embeddings / transcriptionModels / videoModels sections are optional
#    top-level keys the router ingests — see server/src/services/catalog-sync.ts).
# 2. Re-export or bump the version, then sign:
npm run export-catalog -w server -- --tier live --out catalog/data/catalog.live.json
npm run sign -w catalog -- --bump-version     # stamps version = today, signs both tiers
# 3. Ship it: copy catalog.live*.{json,sig} (and monthly on promotion day)
#    to the host's /data volume; the server picks up new files by mtime.
# 4. Monthly (free tier promotion): npm run promote-monthly -w catalog && npm run sign -w catalog
```

Premium promise from the storefront: live refreshed every 2–3 days, monthly
snapshot promoted every ~30 days. **That cadence IS the product.**

## Manual license ops

```bash
npm run create-key -w catalog -- --email customer@example.com --plan annual   # gift/support/outside-Stripe sale
npm run create-key -w catalog -- --email customer@example.com --plan lifetime
# Refunds: refund in Stripe → the charge.refunded webhook revokes the key automatically.
# Lost keys: customer uses /recover; old key dies, replacement is emailed.
```

## Security model (short)

- Catalogs are signed Ed25519; routers pin the public key. The private key is
  used **only** by `npm run sign`, never loaded by the HTTP server.
- License keys are stored as sha256 hashes; plaintext is shown once (email +
  15-min success-page TTL) and never persisted.
- Webhooks: Stripe signature verification + event-id and session-id
  deduplication. Refund/cancel/payment-failure lifecycle is fully automated.
- POST abuse (activate/recover/checkout): per-IP rate limit 30/10min.
