import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { loadEnv, type AppEnv } from '../env.js';
import { ensureStripeEventsTable, openDb, type Db } from '../db.js';
import { CatalogStore } from '../catalog-files.js';
import { LogMailer } from '../mailer.js';
import { generateKeyPairPem, privateKeyFromPem, signBytes } from '../signing.js';
import type { StripeLike, WebhookEvent } from '../stripe-client.js';
import { buildApp } from '../app.js';

export interface TestRig {
  baseUrl: string;
  server: Server;
  db: Db;
  env: AppEnv;
  mailer: LogMailer;
  stripe: FakeStripe;
  publicKeyPem: string;
  dataDir: string;
  close: () => Promise<void>;
}

export function seedCatalogs(dataDir: string, opts?: { liveVersion?: string; monthlyVersion?: string }): {
  publicKeyPem: string;
  liveBytes: Buffer;
  monthlyBytes: Buffer;
} {
  const { publicKeyPem, privateKeyPem } = generateKeyPairPem();
  const priv = privateKeyFromPem(privateKeyPem);
  const mk = (tier: 'live' | 'monthly', version: string): Buffer =>
    Buffer.from(
      JSON.stringify(
        {
          version,
          generatedAt: new Date().toISOString(),
          tier,
          counts: { platforms: 0, models: 0, enabledModels: 0, quirks: 0 },
          platforms: [],
          models: [],
          quirks: [],
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );

  const liveBytes = mk('live', opts?.liveVersion ?? '2026.01.15');
  const monthlyBytes = mk('monthly', opts?.monthlyVersion ?? '2026.01.01');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'catalog.live.json'), liveBytes);
  fs.writeFileSync(path.join(dataDir, 'catalog.live.json.sig'), signBytes(priv, liveBytes));
  fs.writeFileSync(path.join(dataDir, 'catalog.monthly.json'), monthlyBytes);
  fs.writeFileSync(path.join(dataDir, 'catalog.monthly.json.sig'), signBytes(priv, monthlyBytes));
  return { publicKeyPem, liveBytes, monthlyBytes };
}

/**
 * A Stripe double: checkout "sessions" are canned URLs, and webhooks accept
 * any JSON body signed with the literal header `test_sig` — enough to drive
 * the real HTTP routes end to end.
 */
export class FakeStripe implements StripeLike {
  checkoutCalls: { priceId: string; mode: string; plan: string }[] = [];
  portalCalls: string[] = [];
  nextSessionId = 'cs_test_123';

  async createCheckoutSession(args: {
    priceId: string;
    mode: 'subscription' | 'payment';
    plan: 'annual' | 'lifetime';
  }): Promise<{ id: string; url: string }> {
    this.checkoutCalls.push(args);
    return { id: this.nextSessionId, url: `https://stripe.test/checkout/${this.nextSessionId}` };
  }

  async retrieveCheckoutEmail(_id: string): Promise<string | null> {
    return 'buyer@example.com';
  }

  async createPortalSession(customerId: string, _returnUrl: string): Promise<{ url: string }> {
    this.portalCalls.push(customerId);
    return { url: `https://stripe.test/portal/${customerId}` };
  }

  constructWebhookEvent(rawBody: Buffer, signatureHeader: string): WebhookEvent {
    if (signatureHeader !== 'test_sig') throw new Error('No signatures found for this payload');
    const parsed = JSON.parse(rawBody.toString('utf8')) as WebhookEvent;
    return { id: parsed.id, type: parsed.type, data: parsed.data };
  }
}

export async function boot(opts?: {
  liveVersion?: string;
  monthlyVersion?: string;
  withStripe?: boolean;
  env?: Record<string, string>;
}): Promise<TestRig> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-test-'));
  const { publicKeyPem } = seedCatalogs(dataDir, opts);
  const env = loadEnv({
    BRAND_NAME: 'TestBrand',
    BRAND_DOMAIN: 'testbrand.example',
    SITE_URL: 'https://testbrand.example',
    SUPPORT_EMAIL: 'help@testbrand.example',
    STRIPE_PRICE_ANNUAL: 'price_annual',
    STRIPE_PRICE_LIFETIME: 'price_lifetime',
    // Present so checkoutMode computes 'stripe' by default (the FakeStripe
    // seam handles the API itself); manual-mode tests override CHECKOUT_MODE.
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: 'whsec_fake',
    LICENSE_KEY_PREFIX: 'TST',
    ...opts?.env,
  });
  const db = openDb(dataDir);
  ensureStripeEventsTable(db);
  const store = new CatalogStore(dataDir);
  const mailer = new LogMailer();
  const stripe = new FakeStripe();
  const app = buildApp({ env, db, store, mailer, stripe: opts?.withStripe === false ? null : stripe });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    db,
    env,
    mailer,
    stripe,
    publicKeyPem,
    dataDir,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Post a synthetic webhook event through the real raw-body path. */
export async function postWebhook(
  baseUrl: string,
  event: { id: string; type: string; data: Record<string, unknown> },
  sig = 'test_sig',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/v1/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': sig },
    body: JSON.stringify(event),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

export function uniqueEventId(): string {
  return `evt_${Math.random().toString(36).slice(2)}`;
}
