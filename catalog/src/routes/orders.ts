import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db.js';
import { createOrder, getOrder, listOrders, markOrderFulfilled } from '../db.js';
import { evaluate, issueLicense, publicId } from '../keys.js';
import { licenseEmail, type Mailer } from '../mailer.js';
import type { AppEnv } from '../env.js';

/**
 * Manual checkout — the $0 payment rail. The buyer leaves their email and
 * plan on /buy; the server replies (and emails) payment instructions
 * (USDT/PayPal from env). The operator confirms payment and hits
 * POST /v1/admin/orders/:id/fulfill with ADMIN_TOKEN — the license is issued
 * and emailed to the buyer in one shot. Upgrade path to automated Stripe/
 * crypto processors doesn't change anything buyer-visible.
 */

export interface OrdersDeps {
  db: Db;
  env: AppEnv;
  mailer: Mailer;
  /** Debounced backup hook (see backup.ts) after every state change. */
  onStateChange: () => void;
}

export function paymentInstructions(env: AppEnv, plan: 'annual' | 'lifetime'): string {
  const amount = plan === 'lifetime' ? env.priceLifetimeUsd : env.priceAnnualUsd;
  const lines: string[] = [`Amount: $${amount} USD (${plan === 'lifetime' ? 'one-time, lifetime' : 'per year'})`, ''];
  if (env.payment.usdtAddress) {
    lines.push(`USDT (TRC20):`, `  ${env.payment.usdtAddress}`, '');
  }
  if (env.payment.paypalUrl) {
    lines.push(`PayPal:`, `  ${env.payment.paypalUrl}`, '');
  }
  if (env.payment.note) lines.push(env.payment.note, '');
  lines.push(`After paying, reply to the order email (or write to ${env.brand.supportEmail}) with your payment screenshot/txid.`, 'Your license key is delivered to your email once payment is confirmed.');
  return lines.join('\n');
}

export function ordersRouter(deps: OrdersDeps): Router {
  const r = Router();
  const { db, env, mailer } = deps;

  const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    if (!env.adminToken) {
      res.status(503).json({ error: 'ADMIN_TOKEN is not configured on this server.' });
      return;
    }
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${env.adminToken}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };

  /** POST /v1/orders { email, plan, method } — create an order, return + email instructions. */
  r.post('/orders', async (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const plan: 'annual' | 'lifetime' = req.body?.plan === 'lifetime' ? 'lifetime' : 'annual';
    const method = typeof req.body?.method === 'string' && req.body.method.trim() ? req.body.method.trim().slice(0, 40) : 'unspecified';
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Enter a valid email — your key will be delivered there.' });
      return;
    }
    if (!env.payment.usdtAddress && !env.payment.paypalUrl) {
      res.status(503).json({ error: `Payments are being set up — email ${env.brand.supportEmail} and we'll sort you out.` });
      return;
    }

    const order = createOrder(db, { id: publicId('ORD'), email, plan, method });
    deps.onStateChange();
    const instructions = paymentInstructions(env, plan);
    console.log(`[orders] ${order.id}: ${plan} for ${email} via ${method}`);

    const amount = plan === 'lifetime' ? env.priceLifetimeUsd : env.priceAnnualUsd;
    // Buyer instructions + operator ping go out INDEPENDENTLY: a broken mail
    // provider (unverified sender, bad key) must never block the other nor
    // the order itself. All failures log with their target so Render logs are
    // self-diagnosing.
    const sends: [string, string, string][] = [
      [
        email,
        `Order ${order.id} — payment instructions ($${amount} ${plan})`,
        [
          `Thanks! Your order ${order.id} (${env.brand.name} Premium — ${plan}, $${amount} USD) is pending payment.`,
          '',
          instructions,
          '',
          `Order reference: ${order.id}`,
        ].join('\n'),
      ],
      [
        env.brand.supportEmail,
        `[order] ${order.id} — ${plan} $${amount} — ${email} (${method})`,
        `New manual order.\n\nFulfill: POST ${env.brand.siteUrl}/v1/admin/orders/${order.id}/fulfill\n        Authorization: Bearer <ADMIN_TOKEN>\n`,
      ],
    ];
    const results = await Promise.allSettled(sends.map(([to, subject, text]) => mailer.send({ to, subject, text })));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(
          `[orders] mail to ${sends[i][0]} failed:`,
          r.reason instanceof Error ? r.reason.message : r.reason,
        );
      }
    });

    res.json({ orderId: order.id, instructions });
  });

  /** GET /v1/admin/orders?status=pending (Bearer ADMIN_TOKEN). */
  r.get('/admin/orders', requireAdmin, (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const valid = status === 'pending' || status === 'fulfilled' || status === 'canceled' ? status : null;
    res.json({ orders: listOrders(db, valid) });
  });

  /** POST /v1/admin/orders/:id/fulfill — payment confirmed: issue + email key. Idempotent. */
  r.post('/admin/orders/:id/fulfill', requireAdmin, async (req: Request, res: Response) => {
    const order = getOrder(db, String(req.params.id));
    if (!order) {
      res.status(404).json({ error: 'order not found' });
      return;
    }
    if (order.status === 'fulfilled') {
      res.json({ ok: true, alreadyFulfilled: true });
      return;
    }

    const { key, row } = issueLicense(db, { email: order.email, plan: order.plan, prefix: env.licenseKeyPrefix });
    markOrderFulfilled(db, order.id, row.key_hash);
    deps.onStateChange();
    console.log(`[orders] fulfilled ${order.id}: ${order.plan} key for ${order.email}`);

    try {
      const msg = licenseEmail(env.brand.name, key, env.brand.supportEmail);
      await mailer.send({ to: order.email, ...msg });
    } catch (err) {
      console.error('[orders] license email failed:', err instanceof Error ? err.message : err);
    }
    res.json({ ok: true, license: evaluate(row) });
  });

  return r;
}
