import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Db } from '../db.js';
import {
  claimStripeEvent,
  getLicenseByHash,
  getLicenseBySessionId,
  getLicenseBySubscriptionId,
  getLicensesByCustomer,
} from '../db.js';
import { hashKey, issueLicense } from '../keys.js';
import { licenseEmail, type Mailer } from '../mailer.js';
import { subscriptionPeriodEndUnix, unixToIso, type StripeLike } from '../stripe-client.js';
import type { AppEnv } from '../env.js';

/**
 * The money path, split so the webhook can mount with a raw body:
 *   billingPublicRouter: POST /v1/checkout, GET /v1/checkout/session, POST /v1/portal
 *   stripeWebhookHandler: POST /v1/webhooks/stripe (express.raw upstream)
 */

export interface BillingDeps {
  db: Db;
  env: AppEnv;
  stripe: StripeLike | null; // null = degraded mode (503 on these routes)
  mailer: Mailer;
  /** sessionId → plaintext key, 15-min TTL, so the success page can SHOW the
   *  key right after payment. Never persisted (DB stores only hashes). */
  issuedKeys: Map<string, { key: string; at: number }>;
}

const ISSUED_KEY_TTL_MS = 15 * 60 * 1000;

function rememberIssuedKey(map: BillingDeps['issuedKeys'], sessionId: string, key: string): void {
  const cutoff = Date.now() - ISSUED_KEY_TTL_MS;
  for (const [id, v] of map) if (v.at < cutoff) map.delete(id);
  map.set(sessionId, { key, at: Date.now() });
}

function stripeOr503(deps: BillingDeps, res: Response): StripeLike | null {
  if (!deps.stripe) {
    res.status(503).json({ error: 'Billing is not configured on this server.' });
    return null;
  }
  return deps.stripe;
}

export function billingPublicRouter(deps: BillingDeps): Router {
  const r = Router();
  const { db, env } = deps;

  /** The success page polls here after the Stripe redirect. */
  r.get('/checkout/session', (req: Request, res: Response) => {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    const cached = id ? deps.issuedKeys.get(id) : undefined;
    if (cached && Date.now() - cached.at < ISSUED_KEY_TTL_MS) {
      res.json({ issued: true, key: cached.key });
      return;
    }
    // Fulfilled long ago (cache expired / restart): confirm-only. The DB
    // stores hashes, so the plaintext key can no longer be shown — it was
    // emailed at fulfillment and /recover can rotate a replacement.
    const row = id ? getLicenseBySessionId(db, id) : null;
    res.json({ issued: Boolean(row), key: null });
  });

  r.post('/checkout', async (req: Request, res: Response) => {
    const stripe = stripeOr503(deps, res);
    if (!stripe) return;
    const plan = req.body?.plan === 'lifetime' ? 'lifetime' : 'annual';
    const priceId = plan === 'lifetime' ? env.stripe.priceLifetime : env.stripe.priceAnnual;
    if (!priceId) {
      res.status(503).json({ error: `No Stripe price configured for the ${plan} plan.` });
      return;
    }
    try {
      const session = await stripe.createCheckoutSession({
        priceId,
        mode: plan === 'lifetime' ? 'payment' : 'subscription',
        plan,
        successUrl: `${env.brand.siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${env.brand.siteUrl}/#pricing`,
      });
      if (!session.url) throw new Error('Stripe returned no checkout URL');
      res.json({ url: session.url });
    } catch (err) {
      console.error('[checkout]', err instanceof Error ? err.message : err);
      res.status(502).json({ error: 'Could not create a checkout session. Try again shortly.' });
    }
  });

  r.post('/portal', async (req: Request, res: Response) => {
    const stripe = stripeOr503(deps, res);
    if (!stripe) return;
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    const row = key ? getLicenseByHash(db, hashKey(key)) : null;
    if (!row?.stripe_customer_id) {
      res.status(400).json({ error: 'No billing account found for that key.' });
      return;
    }
    try {
      const session = await stripe.createPortalSession(row.stripe_customer_id, env.brand.siteUrl);
      res.json({ url: session.url });
    } catch (err) {
      console.error('[portal]', err instanceof Error ? err.message : err);
      res.status(502).json({ error: 'Could not open the billing portal.' });
    }
  });

  return r;
}

export function stripeWebhookHandler(deps: BillingDeps): (req: Request, res: Response) => Promise<void> {
  const { db, env, mailer } = deps;

  async function fulfillCheckoutSession(session: Record<string, unknown>): Promise<void> {
    const sessionId = String(session.id ?? '');
    if (!sessionId) return;
    if (getLicenseBySessionId(db, sessionId)) return; // replay-safe

    const details = (session.customer_details ?? {}) as Record<string, unknown>;
    const email = (details.email as string) ?? (session.customer_email as string) ?? null;
    if (!email) {
      console.error(`[webhook] checkout session ${sessionId} has no buyer email — cannot fulfill`);
      return;
    }
    const metadata = (session.metadata ?? {}) as Record<string, unknown>;
    const plan: 'annual' | 'lifetime' =
      metadata.plan === 'lifetime' || session.mode === 'payment' ? 'lifetime' : 'annual';

    const { key } = issueLicense(db, {
      email,
      plan,
      prefix: env.licenseKeyPrefix,
      stripeCustomerId: (session.customer as string) ?? null,
      stripeSubscriptionId: (session.subscription as string) ?? null,
      stripeCheckoutSessionId: sessionId,
    });
    rememberIssuedKey(deps.issuedKeys, sessionId, key);
    console.log(`[webhook] issued ${plan} license to ${email} (session ${sessionId})`);

    try {
      const msg = licenseEmail(env.brand.name, key, env.brand.supportEmail);
      await mailer.send({ to: email, ...msg });
    } catch (err) {
      // The license exists and the success page can still show the key; a
      // lost email is recoverable via /recover. Log loudly and keep going.
      console.error('[webhook] license email failed:', err instanceof Error ? err.message : err);
    }
  }

  function onSubscriptionUpdated(sub: Record<string, unknown>): void {
    const id = String(sub.id ?? '');
    const row = id ? getLicenseBySubscriptionId(db, id) : null;
    if (!row) return; // not one of our subscriptions

    const stripeStatus = String(sub.status ?? '');
    let status = row.status;
    if (stripeStatus === 'active' || stripeStatus === 'trialing') status = 'active';
    else if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') status = 'past_due';
    else if (stripeStatus === 'canceled' || stripeStatus === 'incomplete_expired') status = 'canceled';

    const periodEnd = unixToIso(subscriptionPeriodEndUnix(sub));
    db.prepare(
      `UPDATE licenses SET status = ?, cancel_at_period_end = ?,
         current_period_end = COALESCE(?, current_period_end), updated_at = ?
       WHERE key_hash = ?`,
    ).run(status, sub.cancel_at_period_end ? 1 : 0, periodEnd, new Date().toISOString(), row.key_hash);
  }

  function onSubscriptionDeleted(sub: Record<string, unknown>): void {
    const id = String(sub.id ?? '');
    const row = id ? getLicenseBySubscriptionId(db, id) : null;
    if (!row) return;
    db.prepare(`UPDATE licenses SET status = 'canceled', updated_at = ? WHERE key_hash = ?`).run(
      new Date().toISOString(),
      row.key_hash,
    );
  }

  function onInvoicePaymentFailed(invoice: Record<string, unknown>): void {
    const subId = (invoice.subscription as string) ?? null;
    const row = subId ? getLicenseBySubscriptionId(db, subId) : null;
    if (!row) return;
    db.prepare(`UPDATE licenses SET status = 'past_due', updated_at = ? WHERE key_hash = ?`).run(
      new Date().toISOString(),
      row.key_hash,
    );
  }

  function onChargeRefunded(charge: Record<string, unknown>): void {
    const customerId = (charge.customer as string) ?? null;
    if (!customerId) return;
    for (const row of getLicensesByCustomer(db, customerId)) {
      db.prepare(`UPDATE licenses SET status = 'refunded', updated_at = ? WHERE key_hash = ?`).run(
        new Date().toISOString(),
        row.key_hash,
      );
    }
  }

  /**
   * Idempotent two ways: claimed event ids AND per-session issued licenses.
   * A handler failure returns 500 → Stripe retries → replay-safe claims make
   * that retry safe.
   */
  return async (req: Request, res: Response): Promise<void> => {
    const stripe = stripeOr503(deps, res);
    if (!stripe) return;
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.constructWebhookEvent(req.body as Buffer, String(sig ?? ''));
    } catch (err) {
      res.status(400).json({ error: `Webhook signature verification failed: ${err instanceof Error ? err.message : err}` });
      return;
    }
    if (!claimStripeEvent(db, event.id, event.type)) {
      res.json({ received: true, duplicate: true });
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await fulfillCheckoutSession(event.data);
          break;
        case 'customer.subscription.updated':
          onSubscriptionUpdated(event.data);
          break;
        case 'customer.subscription.deleted':
          onSubscriptionDeleted(event.data);
          break;
        case 'invoice.payment_failed':
          onInvoicePaymentFailed(event.data);
          break;
        case 'charge.refunded':
          onChargeRefunded(event.data);
          break;
        default:
          break; // unhandled types are fine — 200 so Stripe stops retrying
      }
    } catch (err) {
      console.error(`[webhook] handler failed for ${event.type}:`, err);
      res.status(500).json({ error: 'handler failed' });
      return;
    }
    res.json({ received: true });
  };
}
