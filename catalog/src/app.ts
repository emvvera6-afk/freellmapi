import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import compression from 'compression';
import type { AppEnv } from './env.js';
import type { Db } from './db.js';
import type { CatalogStore } from './catalog-files.js';
import type { Mailer } from './mailer.js';
import type { StripeLike } from './stripe-client.js';
import { catalogRouter } from './routes/catalog.js';
import { licenseRouter } from './routes/license.js';
import { billingPublicRouter, stripeWebhookHandler, type BillingDeps } from './routes/billing.js';
import { ordersRouter } from './routes/orders.js';
import { siteRouter } from './site.js';

export interface AppDeps {
  env: AppEnv;
  db: Db;
  store: CatalogStore;
  mailer: Mailer;
  stripe: StripeLike | null;
  /** Debounced backup trigger after any state change (orders, licenses). */
  onStateChange?: () => void;
}

/**
 * Naive per-IP fixed-window limiter for abuse-prone POSTs (activation,
 * recovery, checkout). Launch-scale appropriate; move behind CDN rules later.
 */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const entry = hits.get(ip);
    if (!entry || entry.resetAt < now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      res.status(429).json({ error: 'Too many requests — try again in a few minutes.' });
      return;
    }
    next();
  };
}

export function buildApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true); // correct req.ip behind fly.io/railway/nginx

  app.use((_req, res, next) => {
    res.set({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'strict-transport-security': 'max-age=31536000',
    });
    next();
  });

  app.get('/healthz', (_req, res) => {
    const live = deps.store.get('live');
    const monthly = deps.store.get('monthly');
    res.status(live && monthly ? 200 : 503).json({
      ok: Boolean(live && monthly),
      live: live?.version ?? null,
      monthly: monthly?.version ?? null,
      stripe: deps.stripe ? 'configured' : 'degraded',
    });
  });

  // One shared cache: the webhook (fulfillment) writes, the success page reads.
  const issuedKeys: BillingDeps['issuedKeys'] = new Map();
  const billing: BillingDeps = { ...deps, issuedKeys };

  // Webhook FIRST with a raw body — signature verification needs exact bytes.
  const webhook = stripeWebhookHandler(billing);
  app.post('/v1/webhooks/stripe', express.raw({ type: 'application/json', limit: '512kb' }), async (req, res) => {
    await webhook(req, res);
    if (res.statusCode < 400) deps.onStateChange?.();
  });

  app.use(express.json({ limit: '128kb' }));

  const postLimiter = rateLimit(30, 10 * 60 * 1000);
  app.use('/v1/license/activate', postLimiter);
  app.use('/v1/key/recover', postLimiter);
  app.use('/v1/checkout', postLimiter);
  app.use('/v1/orders', postLimiter);

  app.use(
    '/v1',
    compression(),
    catalogRouter({
      db: deps.db,
      store: deps.store,
      mailer: deps.mailer,
      keyPrefix: deps.env.licenseKeyPrefix,
      onStateChange: deps.onStateChange,
    }),
  );
  app.use('/v1', licenseRouter({ db: deps.db }));
  app.use('/v1', billingPublicRouter(billing));
  app.use('/v1', ordersRouter({ db: deps.db, env: deps.env, mailer: deps.mailer, onStateChange: deps.onStateChange ?? (() => {}) }));
  app.use(siteRouter(deps.env));

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[http] unhandled:', err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
