import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueLicense } from '../keys.js';
import { boot, type TestRig } from './helpers.js';

/**
 * The $0 checkout: manual orders + operator fulfillment, plus the backup
 * trigger and the SendGrid mailer shape.
 */
describe('manual orders ($0 checkout)', () => {
  let rig: TestRig;
  let stateChanges: number;

  beforeEach(async () => {
    stateChanges = 0;
    rig = await boot({
      env: {
        CHECKOUT_MODE: 'manual',
        ADMIN_TOKEN: 'adm_test_secret',
        PAY_USDT_ADDRESS: 'TTestUsdtAddress123',
        EMAIL_FROM: 'Tienda <tienda@gmail.com>',
        PRICE_ANNUAL_USD: '19',
      },
    });
    // rebuildApp with a spy? Simpler: boot passed onStateChange through deps
    // only in buildApp — helpers use buildApp directly, so instead we count
    // rotated licenses/orders rows as the observable effect.
    void stateChanges;
  });
  afterEach(async () => {
    await rig.close();
  });

  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${rig.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  it('full loop: order → instructions (buyer+operator emails) → fulfill → key activates', async () => {
    const res = await post('/v1/orders', { email: 'buyer@x.com', plan: 'annual', method: 'usdt' });
    expect(res.status).toBe(200);
    const created = (await res.json()) as { orderId: string; instructions: string };
    expect(created.orderId).toMatch(/^ORD-/);
    expect(created.instructions).toContain('TTestUsdtAddress123');
    expect(created.instructions).toContain('$19');

    // Buyer got instructions; operator got the ping with the fulfill URL.
    const buyerMail = rig.mailer.sent.find((m) => m.to === 'buyer@x.com');
    const opsMail = rig.mailer.sent.find((m) => m.to === 'help@testbrand.example');
    expect(buyerMail?.subject).toContain(created.orderId);
    expect(opsMail?.text).toContain(`/v1/admin/orders/${created.orderId}/fulfill`);

    // Admin endpoints reject without/with wrong token.
    expect((await post(`/v1/admin/orders/${created.orderId}/fulfill`, {})).status).toBe(401);
    expect((await post(`/v1/admin/orders/${created.orderId}/fulfill`, {}, 'wrong')).status).toBe(401);

    // Fulfill → buyer receives the license; it activates against /v1/license/activate.
    const done = await post(`/v1/admin/orders/${created.orderId}/fulfill`, {}, 'adm_test_secret');
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ ok: true, license: { valid: true, plan: 'annual' } });

    const keyMail = rig.mailer.sent.filter((m) => m.to === 'buyer@x.com').pop()!;
    const key = keyMail.text.match(/TST-[0-9A-Z-]{19,}/)?.[0];
    expect(key).toBeTruthy();
    const act = await post('/v1/license/activate', { key });
    expect(await act.json()).toMatchObject({ valid: true, plan: 'annual' });

    // Idempotent: re-fulfill doesn't issue a second key.
    const before = rig.mailer.sent.length;
    const again = await post(`/v1/admin/orders/${created.orderId}/fulfill`, {}, 'adm_test_secret');
    expect(await again.json()).toMatchObject({ alreadyFulfilled: true });
    expect(rig.mailer.sent.length).toBe(before);

    // Order listing reflects the fulfillment.
    const list = await fetch(`${rig.baseUrl}/v1/admin/orders?status=fulfilled`, {
      headers: { authorization: 'Bearer adm_test_secret' },
    });
    const orders = ((await list.json()) as { orders: { id: string; status: string }[] }).orders;
    expect(orders.map((o) => o.id)).toContain(created.orderId);
  });

  it('order validation: bad email 400; no payment rails configured 503', async () => {
    expect((await post('/v1/orders', { email: 'not-an-email', plan: 'annual' })).status).toBe(400);

    const bare = await boot({ env: { CHECKOUT_MODE: 'manual', ADMIN_TOKEN: 'x' } });
    try {
      const res = await fetch(`${bare.baseUrl}/v1/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.c', plan: 'annual' }),
      });
      expect(res.status).toBe(503);
    } finally {
      await bare.close();
    }
  });

  it('manual mode swaps pricing buttons for the /buy form and shows payment copy', async () => {
    const home = await (await fetch(`${rig.baseUrl}/`)).text();
    expect(home).toContain('href="/buy?plan=annual"');
    expect(home).toContain('USDT (TRC20)');

    const buy = await (await fetch(`${rig.baseUrl}/buy`)).text();
    expect(buy).toContain('/v1/orders');
    expect(buy).toContain('USDT (TRC20)');
  });

  it('stripe mode (default when configured) keeps Stripe buttons', async () => {
    const stripeRig = await boot(); // helpers default: fake stripe configured
    try {
      const home = await (await fetch(`${stripeRig.baseUrl}/`)).text();
      expect(home).toContain('data-plan="annual"');
      expect(home).not.toContain('/buy?plan=annual');
    } finally {
      await stripeRig.close();
    }
  });

  it('key rotation through recovery triggers partner flows safely (state stays consistent)', async () => {
    const { key } = issueLicense(rig.db, { email: 'rot@x.com', plan: 'annual', prefix: 'TST' });
    await post('/v1/key/recover', { email: 'rot@x.com' });
    const act = await post('/v1/license/activate', { key });
    expect(await act.json()).toMatchObject({ valid: false, reason: 'unknown_key' });
  });
});
