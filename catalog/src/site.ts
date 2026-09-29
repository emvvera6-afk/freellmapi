import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AppEnv } from './env.js';

/**
 * The storefront. Dependency-free pages (inline CSS/JS) so the whole site
 * deploys with the service — no CDN, no build step, no frontend hosting.
 * Every brand string comes from env, so a rebrand is a redeploy, not a PR.
 */

interface Ctx {
  brand: AppEnv['brand'];
  priceAnnual: string;
  priceLifetime: string;
  checkoutMode: AppEnv['checkoutMode'];
  payment: AppEnv['payment'];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function layout(ctx: Ctx, title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · ${esc(ctx.brand.name)}</title>
<meta name="description" content="${esc(ctx.brand.name)} Premium — the live model catalog feed for your self-hosted LLM router." />
<style>
  :root { --bg:#0b0f14; --card:#121a23; --line:#22303f; --fg:#e8eef4; --mut:#93a5b5; --acc:#4f8cff; --acc2:#22c58b; }
  * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--fg);
    font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  a { color:var(--acc); text-decoration:none; } a:hover { text-decoration:underline; }
  .wrap { max-width:960px; margin:0 auto; padding:0 20px; }
  header { padding:28px 0; display:flex; justify-content:space-between; align-items:center; }
  .logo { font-weight:800; font-size:20px; letter-spacing:-.02em; }
  nav a { margin-left:18px; color:var(--mut); font-size:14px; }
  .hero { text-align:center; padding:72px 0 48px; }
  .hero h1 { font-size:clamp(30px,5vw,48px); line-height:1.15; margin:0 0 16px; letter-spacing:-.03em; }
  .hero p { color:var(--mut); font-size:18px; max-width:640px; margin:0 auto 28px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:26px; }
  .grid { display:grid; gap:20px; } @media(min-width:760px){ .cols2 { grid-template-columns:1fr 1fr; } .cols3 { grid-template-columns:repeat(3,1fr); } }
  .price { font-size:40px; font-weight:800; letter-spacing:-.03em; }
  .per { color:var(--mut); font-size:14px; }
  ul.tick { list-style:none; padding:0; margin:16px 0 22px; } ul.tick li { padding-left:26px; position:relative; margin:8px 0; color:var(--mut); }
  ul.tick li::before { content:"✓"; position:absolute; left:0; color:var(--acc2); font-weight:700; }
  .btn { display:inline-block; background:var(--acc); color:#fff !important; font-weight:700; border:0; cursor:pointer;
     padding:13px 26px; border-radius:10px; font-size:16px; width:100%; text-align:center; }
  .btn:hover { filter:brightness(1.08); text-decoration:none; } .btn:disabled { opacity:.6; cursor:wait; }
  .btn.big { width:auto; padding:15px 38px; font-size:17px; }
  .badge { display:inline-block; background:rgba(34,197,139,.12); color:var(--acc2); border:1px solid rgba(34,197,139,.35);
     font-size:12px; font-weight:700; padding:3px 10px; border-radius:99px; margin-bottom:10px; }
  section { padding:44px 0; } h2 { letter-spacing:-.02em; font-size:26px; } h3 { font-size:17px; margin:0 0 8px; }
  .mut { color:var(--mut); } .small { font-size:13px; }
  details { border-top:1px solid var(--line); padding:14px 0; } summary { cursor:pointer; font-weight:600; }
  details p { color:var(--mut); margin:8px 0 0; }
  footer { border-top:1px solid var(--line); margin-top:40px; padding:26px 0 44px; color:var(--mut); font-size:13px; }
  footer a { color:var(--mut); margin-right:16px; }
  input[type=email] { width:100%; padding:13px 14px; border-radius:10px; border:1px solid var(--line);
     background:var(--bg); color:var(--fg); font-size:16px; margin-bottom:12px; }
  .key { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); border:1px dashed var(--acc2);
     padding:14px; border-radius:10px; font-size:18px; text-align:center; word-break:break-all; }
  .note { background:rgba(79,140,255,.08); border:1px solid rgba(79,140,255,.3); border-radius:12px; padding:14px 16px; color:var(--mut); font-size:14px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">${esc(ctx.brand.name)}</div>
    <nav>
      <a href="${esc(ctx.brand.githubUrl)}" rel="noopener">Open-source app</a>
      <a href="#pricing">Pricing</a>
      <a href="#faq">FAQ</a>
      <a href="/recover">Key recovery</a>
    </nav>
  </header>
  ${body}
  <footer>
    <div>© ${new Date().getFullYear()} ${esc(ctx.brand.name)} · <a href="${esc(ctx.brand.githubUrl)}" rel="noopener">GitHub</a></div>
    <div style="margin-top:8px">
      <a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/refunds">Refunds</a>
      <a href="mailto:${esc(ctx.brand.supportEmail)}">${esc(ctx.brand.supportEmail)}</a>
    </div>
    <div class="small mut" style="margin-top:10px">The router app is free and open source (MIT). Premium is an optional subscription to the live catalog feed — it never touches your API keys, which stay on your machine, encrypted.</div>
  </footer>
</div>
</body>
</html>`;
}

function buyButton(ctx: Ctx, plan: 'annual' | 'lifetime', label: string): string {
  if (ctx.checkoutMode === 'stripe') {
    return `<button class="btn" data-plan="${plan}">${label}</button>`;
  }
  return `<a class="btn" href="/buy?plan=${plan}">${label}</a>`;
}

function paymentsNote(ctx: Ctx): string {
  if (ctx.checkoutMode === 'stripe') return 'Payments by Stripe.';
  const methods: string[] = [];
  if (ctx.payment.usdtAddress) methods.push('USDT (TRC20)');
  if (ctx.payment.paypalUrl) methods.push('PayPal');
  return methods.length
    ? `Pay with ${methods.join(' or ')} — your license key arrives by email after confirmation (usually within minutes, always within 24h).`
    : '';
}

function buyPage(ctx: Ctx): string {
  const planButtons = `
    <div class="grid cols2" style="margin-bottom:16px">
      <label class="card" style="cursor:pointer" id="card-annual">
        <input type="radio" name="plan" value="annual" checked /> <b>Annual</b> — $${esc(ctx.priceAnnual)}/yr
      </label>
      <label class="card" style="cursor:pointer" id="card-lifetime">
        <input type="radio" name="plan" value="lifetime" /> <b>Lifetime</b> — $${esc(ctx.priceLifetime)} once
      </label>
    </div>`;
  const methodOptions = [
    ctx.payment.usdtAddress ? '<option value="usdt">USDT (TRC20)</option>' : '',
    ctx.payment.paypalUrl ? '<option value="paypal">PayPal</option>' : '',
    '<option value="other">Other / I\'ll ask by email</option>',
  ].join('');
  const body = `
  <section class="hero" style="padding-top:40px">
    <h1>Order Premium</h1>
    <p>Leave your email, pay with your preferred method, and your license key
       arrives in your inbox after confirmation. Usually minutes, always within 24h.</p>
  </section>
  <section style="max-width:560px;margin:0 auto">
    <div class="card" id="form-card">
      ${planButtons}
      <input type="email" id="email" placeholder="you@example.com — key delivery address" required />
      <select id="method" style="width:100%;padding:13px 14px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font-size:16px;margin-bottom:12px">
        ${methodOptions}
      </select>
      <button class="btn" id="go">Get payment instructions</button>
      <p class="small mut" style="margin:12px 0 0">No account, no card stored. Your email is used only to deliver the key.</p>
    </div>
    <div class="card" id="done-card" style="display:none">
      <h3 style="margin-top:0">Order <span id="oid"></span> created ✓</h3>
      <p class="mut small">Pay with any of these methods, then send your txid/screenshot to
        <a href="mailto:${esc(ctx.brand.supportEmail)}">${esc(ctx.brand.supportEmail)}</a> quoting your order id.
        These same instructions were just emailed to you.</p>
      <pre id="instructions" style="white-space:pre-wrap;background:var(--bg);border:1px dashed var(--line);border-radius:10px;padding:14px;font-size:14px"></pre>
    </div>
  </section>
<script>
// Preselect plan from ?plan=lifetime
const q = new URLSearchParams(location.search);
if (q.get('plan') === 'lifetime') document.querySelector('input[value=lifetime]').checked = true;

document.getElementById('go').addEventListener('click', async () => {
  const btn = document.getElementById('go');
  const email = document.getElementById('email').value;
  const plan = document.querySelector('input[name=plan]:checked').value;
  const method = document.getElementById('method').value;
  btn.disabled = true; btn.textContent = 'Creating order…';
  try {
    const res = await fetch('/v1/orders', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, plan, method }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create the order');
    document.getElementById('oid').textContent = data.orderId;
    document.getElementById('instructions').textContent = data.instructions;
    document.getElementById('form-card').style.display = 'none';
    document.getElementById('done-card').style.display = 'block';
  } catch (e) {
    alert(e.message);
    btn.disabled = false; btn.textContent = 'Get payment instructions';
  }
});
</script>`;
  return layout(ctx, 'Order Premium', body);
}

function homePage(ctx: Ctx): string {
  const body = `
  <section class="hero">
    <h1>Every free LLM tier.<br/>One live catalog.</h1>
    <p>The free-tier landscape shifts weekly — models launch, die, and change quotas without notice.
       ${esc(ctx.brand.name)} tracks it for you and feeds your self-hosted router a verified, same-day catalog.
       Free installs lag a month behind. You won't.</p>
    <a class="btn big" href="#pricing">Get Premium</a>
  </section>

  <section class="grid cols3">
    <div class="card"><h3>Same-day catalog</h3><p class="mut">New free models, quota changes and provider quirks land in your router the day we publish them — not 30 days later.</p></div>
    <div class="card"><h3>Signed &amp; verified</h3><p class="mut">Ed25519-signed feed, verified by a pinned key in the app. A tampered CDN or MITM cannot inject models into your router.</p></div>
    <div class="card"><h3>Self-hosted, always</h3><p class="mut">Your provider keys never leave your machine. Premium only changes how fresh your model catalog is. Cancel anytime.</p></div>
  </section>

  <section id="pricing">
    <h2>Pricing</h2>
    <div class="grid cols2" style="margin-top:18px">
      <div class="card">
        <div class="badge">MOST POPULAR</div>
        <h3>Annual</h3>
        <div class="price">$${esc(ctx.priceAnnual)}<span class="per">/year</span></div>
        <ul class="tick">
          <li>Live catalog feed, refreshed every 2–3 days</li>
          <li>One license key, unlimited installs you own</li>
          <li>Self-serve cancellation &amp; invoices</li>
          <li>14-day refund, no questions asked</li>
        </ul>
        ${buyButton(ctx, 'annual', `Subscribe — $${esc(ctx.priceAnnual)}/yr`)}
      </div>
      <div class="card">
        <h3>Lifetime</h3>
        <div class="price">$${esc(ctx.priceLifetime)}<span class="per"> once</span></div>
        <ul class="tick">
          <li>Everything in Annual, forever</li>
          <li>No renewal to think about</li>
          <li>Thank-you credit in the release notes</li>
          <li>14-day refund, no questions asked</li>
        </ul>
        ${buyButton(ctx, 'lifetime', 'Buy lifetime')}
      </div>
    </div>
    <p class="small mut" style="margin-top:14px">${paymentsNote(ctx)} The app itself stays free, open source, and fully functional on the monthly snapshot forever.</p>
  </section>

  <section>
    <h2>How it works</h2>
    <div class="grid cols3" style="margin-top:18px">
      <div class="card"><h3>1 · Buy</h3><p class="mut">Check out with Stripe. Your license key appears instantly and lands in your inbox.</p></div>
      <div class="card"><h3>2 · Paste</h3><p class="mut">In the app: <b>Settings → Premium</b>, paste the key. That's all — no account, no lock-in.</p></div>
      <div class="card"><h3>3 · Stay current</h3><p class="mut">Your router pulls the signed live catalog twice a day. New free models appear as they launch.</p></div>
    </div>
  </section>

  <section id="faq">
    <h2>FAQ</h2>
    <div style="margin-top:12px">
      <details><summary>What exactly am I paying for?</summary>
        <p>The catalog update service: continuous editorial work tracking dozens of free LLM providers — new models, retirements, quota changes, request quirks — packaged into a signed feed your router verifies and applies automatically. The software itself is MIT-licensed and free forever, including the monthly snapshot feed.</p></details>
      <details><summary>Do my API keys or prompts go through your servers?</summary>
        <p>No. The router runs on your hardware and talks to LLM providers directly. Your keys are encrypted locally. The only thing our server ever sees is your license key when your install checks for catalog updates.</p></details>
      <details><summary>How do I cancel?</summary>
        <p>In the app: Settings → Premium → Manage subscription opens the Stripe billing portal — cancel, change cards, download invoices, entirely self-serve. Annual stays active until the paid year ends.</p></details>
      <details><summary>I lost my license key.</summary>
        <p>Use <a href="/recover">key recovery</a>: enter your purchase email and we rotate a fresh key to your inbox (the old one stops working).</p></details>
      <details><summary>What's the refund policy?</summary>
        <p>Full refund within 14 days of purchase, no questions asked — see <a href="/refunds">Refunds</a>.</p></details>
      <details><summary>How many installs can use one key?</summary>
        <p>All the machines you personally own or operate. Don't publish the key — recovered or abused keys get rotated.</p></details>
    </div>
  </section>

<script>
for (const btn of document.querySelectorAll('button[data-plan]')) {
  btn.addEventListener('click', async () => {
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Redirecting to Stripe…';
    try {
      const res = await fetch('/v1/checkout', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: btn.dataset.plan }) });
      const data = await res.json();
      if (data.url) { location.href = data.url; return; }
      throw new Error(data.error || 'Checkout unavailable');
    } catch (e) {
      alert(e.message || 'Something went wrong — please try again.');
      btn.disabled = false; btn.textContent = old;
    }
  });
}
</script>`;
  return layout(ctx, 'Premium — live model catalog', body);
}

function recoverPage(ctx: Ctx): string {
  const body = `
  <section class="hero" style="padding-top:40px">
    <h1>Key recovery</h1>
    <p>Enter the email you purchased with. We'll rotate a fresh license key to your inbox —
       the old key stops working immediately.</p>
  </section>
  <section style="max-width:460px;margin:0 auto">
    <div class="card">
      <form id="f">
        <input type="email" id="email" placeholder="you@example.com" required />
        <button class="btn" type="submit">Email me a new key</button>
      </form>
      <p id="msg" class="small mut" style="margin:14px 0 0"></p>
    </div>
  </section>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('msg');
  msg.textContent = 'Sending…';
  try {
    await fetch('/v1/key/recover', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('email').value }) });
  } catch {}
  msg.textContent = 'If that email has an active license, a new key is on its way. Check spam too.';
});
</script>`;
  return layout(ctx, 'Key recovery', body);
}

function successPage(ctx: Ctx): string {
  const body = `
  <section class="hero" style="padding-top:40px">
    <h1>You're in 🎉</h1>
    <p id="status">Finalizing your license…</p>
  </section>
  <section style="max-width:520px;margin:0 auto">
    <div class="card" id="keycard" style="display:none">
      <p class="mut small" style="margin-top:0">Your license key (also emailed to you):</p>
      <div class="key" id="key"></div>
      <p class="small mut" style="margin-top:14px">Paste it in the app: <b>Settings → Premium</b>. The live catalog switches on within seconds.</p>
    </div>
    <div class="note" id="waitnote" style="margin-top:18px">
      If your key doesn't appear in a minute, it's in your inbox (check spam). You can also use
      <a href="/recover">key recovery</a> anytime with your purchase email.
    </div>
  </section>
<script>
(async () => {
  const id = new URLSearchParams(location.search).get('session_id');
  if (!id) { document.getElementById('status').textContent = 'Missing session — check your email for the key.'; return; }
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('/v1/checkout/session?id=' + encodeURIComponent(id));
      const d = await res.json();
      if (d.issued) {
        document.getElementById('status').textContent = 'Your Premium license is active.';
        if (d.key) {
          document.getElementById('key').textContent = d.key;
          document.getElementById('keycard').style.display = 'block';
        }
        return;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  document.getElementById('status').textContent = 'Taking longer than usual — your key is on its way by email.';
})();
</script>`;
  return layout(ctx, 'Purchase complete', body);
}

function legalPage(ctx: Ctx, kind: 'terms' | 'privacy' | 'refunds'): string {
  const b = esc(ctx.brand.name);
  const email = esc(ctx.brand.supportEmail);
  const bodies: Record<string, string> = {
    terms: `<h2>Terms of Service</h2><div class="card mut">
      <p><b>The service.</b> ${b} Premium is a subscription (or one-time lifetime purchase) to a digitally delivered model-catalog feed for the open-source router application. The application itself is licensed separately under the MIT license.</p>
      <p><b>License keys.</b> A key is personal to the purchaser, valid on machines they own or operate. Keys must not be published or shared publicly; abused keys may be rotated or revoked.</p>
      <p><b>Availability.</b> The feed describes third-party providers' free tiers. Those providers change, suspend, or terminate their free offerings at will; the catalog reflects best-effort editorial tracking and is provided "as is", without warranty of accuracy or continued availability of any listed provider.</p>
      <p><b>Acceptable use.</b> You remain bound by each upstream provider's own terms when you use their free tier.</p>
      <p><b>Contact.</b> ${email}</p></div>`,
    privacy: `<h2>Privacy Policy</h2><div class="card mut">
      <p><b>What we collect.</b> Your purchase email (from Stripe) and the license key hash used when your router checks for updates. Payment details are handled entirely by Stripe — we never see card numbers.</p>
      <p><b>What we never see.</b> Your LLM provider API keys, prompts, or completions. The router runs on your hardware and talks to providers directly.</p>
      <p><b>What we do with it.</b> Issue and validate license keys, deliver receipts and recovery emails. We do not sell data, run ads, or use trackers on this site.</p>
      <p><b>Deletion.</b> Email ${email} and we delete your purchase record; active licenses tied to it are revoked without refund unless local law says otherwise.</p></div>`,
    refunds: `<h2>Refund Policy</h2><div class="card mut">
      <p><b>14 days, no questions.</b> Full refund within 14 days of any purchase — email ${email} from your purchase address and include your license key or receipt.</p>
      <p><b>After 14 days.</b> Annual subscriptions can still be canceled anytime from the billing portal (Settings → Premium → Manage subscription); the term you paid for stays active until it ends. Lifetime purchases are refunded only where required by law.</p>
      <p><b>Effect.</b> A refunded key stops validating; your router gracefully falls back to the free monthly catalog snapshot. Nothing breaks.</p></div>`,
  };
  return layout(ctx, kind[0].toUpperCase() + kind.slice(1), `<section>${bodies[kind]}</section>`);
}

export function siteRouter(env: AppEnv): Router {
  const ctx: Ctx = {
    brand: env.brand,
    priceAnnual: env.priceAnnualUsd,
    priceLifetime: env.priceLifetimeUsd,
    checkoutMode: env.checkoutMode,
    payment: env.payment,
  };
  const r = Router();
  const html = (res: Response, page: string) => res.status(200).set('content-type', 'text/html; charset=utf-8').send(page);

  r.get('/', (_req: Request, res: Response) => html(res, homePage(ctx)));
  r.get('/buy', (_req: Request, res: Response) => html(res, buyPage(ctx)));
  r.get('/recover', (_req: Request, res: Response) => html(res, recoverPage(ctx)));
  r.get('/success', (_req: Request, res: Response) => html(res, successPage(ctx)));
  r.get('/terms', (_req: Request, res: Response) => html(res, legalPage(ctx, 'terms')));
  r.get('/privacy', (_req: Request, res: Response) => html(res, legalPage(ctx, 'privacy')));
  r.get('/refunds', (_req: Request, res: Response) => html(res, legalPage(ctx, 'refunds')));

  return r;
}
