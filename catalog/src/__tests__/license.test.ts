import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueLicense } from '../keys.js';
import { boot, type TestRig } from './helpers.js';

describe('license lifecycle endpoints', () => {
  let rig: TestRig;
  beforeEach(async () => {
    rig = await boot();
  });
  afterEach(async () => {
    await rig.close();
  });

  const activate = async (key: string) => {
    const res = await fetch(`${rig.baseUrl}/v1/license/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    return res.json() as Promise<Record<string, unknown>>;
  };

  const check = async (key: string) => {
    const res = await fetch(`${rig.baseUrl}/v1/license/check`, { headers: { authorization: `Bearer ${key}` } });
    return res.json() as Promise<Record<string, unknown>>;
  };

  it('activate: unknown key -> valid:false, reason unknown_key', async () => {
    expect(await activate('TST-XXXX-XXXX-XXXX-XXXX')).toMatchObject({ valid: false, reason: 'unknown_key' });
  });

  it('activate + check: a freshly issued annual key validates with plan + expiry', async () => {
    const { key } = issueLicense(rig.db, { email: 'a@example.com', plan: 'annual', prefix: 'TST' });
    const payload = await activate(key);
    expect(payload).toMatchObject({ valid: true, plan: 'annual', status: 'active' });
    expect(typeof payload.expiresAt).toBe('string');
    expect(await check(key)).toMatchObject({ valid: true, plan: 'annual' });
  });

  it('lifetime keys are valid with no expiry', async () => {
    const { key } = issueLicense(rig.db, { email: 'l@example.com', plan: 'lifetime', prefix: 'TST' });
    expect(await activate(key)).toMatchObject({ valid: true, plan: 'lifetime', expiresAt: null });
  });

  it('expired annual keys fail with reason expired', async () => {
    const { key } = issueLicense(rig.db, {
      email: 'e@example.com',
      plan: 'annual',
      prefix: 'TST',
      periodEnd: new Date(Date.now() - 1000),
    });
    expect(await activate(key)).toMatchObject({ valid: false, reason: 'expired' });
  });

  it('canceled / refunded / past_due rows surface their reasons', async () => {
    const { key } = issueLicense(rig.db, { email: 'c@example.com', plan: 'annual', prefix: 'TST' });
    const statuses: [string, string][] = [
      ['canceled', 'canceled'],
      ['refunded', 'refunded'],
      ['past_due', 'past_due'],
    ];
    for (const [status, reason] of statuses) {
      rig.db.prepare('UPDATE licenses SET status = ? WHERE email = ?').run(status, 'c@example.com');
      expect(await activate(key)).toMatchObject({ valid: false, reason });
    }
  });

  it('key recovery rotates: old key dies, replacement arrives by email and works', async () => {
    const { key } = issueLicense(rig.db, { email: 'lost@example.com', plan: 'annual', prefix: 'TST' });

    const res = await fetch(`${rig.baseUrl}/v1/key/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'lost@example.com' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const mail = rig.mailer.sent.find((m) => m.to === 'lost@example.com');
    expect(mail).toBeTruthy();
    const newKey = mail!.text.match(/TST-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/)?.[0];
    expect(newKey).toBeTruthy();

    expect(await activate(key)).toMatchObject({ valid: false, reason: 'unknown_key' });
    expect(await activate(newKey!)).toMatchObject({ valid: true, plan: 'annual' });
  });

  it('recovery with an unknown email is a silent 200 (no enumeration)', async () => {
    const res = await fetch(`${rig.baseUrl}/v1/key/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com' }),
    });
    expect(res.status).toBe(200);
    expect(rig.mailer.sent).toHaveLength(0);
  });
});
