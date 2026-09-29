import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boot, postWebhook, uniqueEventId, type TestRig } from './helpers.js';

describe('billing (Stripe seam)', () => {
  let rig: TestRig;
  beforeEach(async () => {
    rig = await boot();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('checkout creates a session for each plan; degraded mode answers 503', async () => {
    const res = await fetch(`${rig.baseUrl}/v1/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'lifetime' }),
    });
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain('stripe.test/checkout/');
    expect(rig.stripe.checkoutCalls[0]).toMatchObject({
      priceId: 'price_lifetime',
      mode: 'payment',
      plan: 'lifetime',
    });

    const degraded = await boot({ withStripe: false });
    try {
      const r = await fetch(`${degraded.baseUrl}/v1/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: 'annual' }),
      });
      expect(r.status).toBe(503);
    } finally {
      await degraded.close();
    }
  });

  it('checkout.session.completed issues a license, emails it, and the success page can show it', async () => {
    const session = {
      id: 'cs_happy_1',
      mode: 'subscription',
      customer: 'cus_1',
      subscription: 'sub_1',
      customer_details: { email: 'buyer@example.com' },
      metadata: { plan: 'annual' },
    };
    const { status } = await postWebhook(rig.baseUrl, { id: uniqueEventId(), type: 'checkout.session.completed', data: session });
    expect(status).toBe(200);

    const mail = rig.mailer.sent.find((m) => m.to === 'buyer@example.com');
    expect(mail).toBeTruthy();
    const key = mail!.text.match(/TST-[0-9A-Z-]{19,}/)?.[0];
    expect(key).toBeTruthy();

    // Key really activates.
    const act = await fetch(`${rig.baseUrl}/v1/license/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    expect(await act.json()).toMatchObject({ valid: true, plan: 'annual' });

    // …and the live tier opens up.
    const latest = await fetch(`${rig.baseUrl}/v1/latest`, { headers: { authorization: `Bearer ${key}` } });
    expect(latest.headers.get('x-catalog-tier')).toBe('live');

    // Success page lookup (same session id) shows the key within the TTL.
    const lookup = await fetch(`${rig.baseUrl}/v1/checkout/session?id=cs_happy_1`);
    expect(await lookup.json()).toEqual({ issued: true, key });
  });

  it('webhook replay protection: same event id + same session both dedupe to one license', async () => {
    const event = {
      id: 'evt_dup',
      type: 'checkout.session.completed',
      data: { id: 'cs_dup', mode: 'payment', customer: 'cus_2', customer_details: { email: 'd@example.com' }, metadata: {} },
    };
    const first = await postWebhook(rig.baseUrl, event);
    expect(first.body).toMatchObject({ received: true });
    const second = await postWebhook(rig.baseUrl, event);
    expect(second.body).toMatchObject({ duplicate: true });

    // Same session under a NEW event id still issues nothing extra.
    const third = await postWebhook(rig.baseUrl, { ...event, id: 'evt_dup_2' });
    expect(third.body).toMatchObject({ received: true });
    const count = rig.db.prepare('SELECT COUNT(*) AS n FROM licenses').get() as { n: number };
    expect(count.n).toBe(1);

    // Payment mode inferred lifetime.
    expect(rig.db.prepare('SELECT plan FROM licenses').get()).toEqual({ plan: 'lifetime' });
  });

  it('rejects webhooks with a bad signature', async () => {
    const { status } = await postWebhook(
      rig.baseUrl,
      { id: uniqueEventId(), type: 'checkout.session.completed', data: {} },
      'forged',
    );
    expect(status).toBe(400);
  });

  it('subscription lifecycle: past_due then cancellation close the live tier with the right reasons', async () => {
    await postWebhook(rig.baseUrl, {
      id: uniqueEventId(),
      type: 'checkout.session.completed',
      data: {
        id: 'cs_lc',
        mode: 'subscription',
        customer: 'cus_lc',
        subscription: 'sub_lc',
        customer_details: { email: 'lc@example.com' },
        metadata: { plan: 'annual' },
      },
    });
    const mail = rig.mailer.sent.find((m) => m.to === 'lc@example.com')!;
    const key = mail.text.match(/TST-[0-9A-Z-]{19,}/)![0];

    const activate = async () => {
      const res = await fetch(`${rig.baseUrl}/v1/license/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      return res.json() as Promise<Record<string, unknown>>;
    };

    await postWebhook(rig.baseUrl, {
      id: uniqueEventId(),
      type: 'customer.subscription.updated',
      data: { id: 'sub_lc', status: 'past_due', current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30, cancel_at_period_end: false },
    });
    expect(await activate()).toMatchObject({ valid: false, reason: 'past_due' });

    await postWebhook(rig.baseUrl, {
      id: uniqueEventId(),
      type: 'customer.subscription.updated',
      data: { id: 'sub_lc', status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30, cancel_at_period_end: true },
    });
    expect(await activate()).toMatchObject({ valid: true, cancelAtPeriodEnd: true });

    await postWebhook(rig.baseUrl, {
      id: uniqueEventId(),
      type: 'customer.subscription.deleted',
      data: { id: 'sub_lc', status: 'canceled' },
    });
    expect(await activate()).toMatchObject({ valid: false, reason: 'canceled' });
  });

  it('charge.refunded revokes every license belonging to that customer', async () => {
    await postWebhook(rig.baseUrl, {
      id: uniqueEventId(),
      type: 'checkout.session.completed',
      data: { id: 'cs_rf', mode: 'subscription', customer: 'cus_rf', subscription: 'sub_rf', customer_details: { email: 'rf@example.com' }, metadata: { plan: 'annual' } },
    });
    await postWebhook(rig.baseUrl, { id: uniqueEventId(), type: 'charge.refunded', data: { customer: 'cus_rf' } });

    const mail = rig.mailer.sent.find((m) => m.to === 'rf@example.com')!;
    const key = mail.text.match(/TST-[0-9A-Z-]{19,}/)![0];
    const res = await fetch(`${rig.baseUrl}/v1/license/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    expect(await res.json()).toMatchObject({ valid: false, reason: 'refunded' });
  });

  it('portal: unknown key 400, known key returns a portal URL for the right customer', async () => {
    const bad = await fetch(`${rig.baseUrl}/v1/portal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'TST-XXXX-XXXX-XXXX-XXXX' }),
    });
    expect(bad.status).toBe(400);

    await postWebhook(rig.baseUrl, {
      id: uniqueEventId(),
      type: 'checkout.session.completed',
      data: { id: 'cs_pt', mode: 'subscription', customer: 'cus_pt', subscription: 'sub_pt', customer_details: { email: 'pt@example.com' }, metadata: { plan: 'annual' } },
    });
    const mail = rig.mailer.sent.find((m) => m.to === 'pt@example.com')!;
    const key = mail.text.match(/TST-[0-9A-Z-]{19,}/)![0];
    const res = await fetch(`${rig.baseUrl}/v1/portal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    expect(await res.json()).toEqual({ url: 'https://stripe.test/portal/cus_pt' });
    expect(rig.stripe.portalCalls).toEqual(['cus_pt']);
  });
});
