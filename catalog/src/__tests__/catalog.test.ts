import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueLicense, hashKey } from '../keys.js';
import { publicKeyFromPem } from '../signing.js';
import { boot, type TestRig } from './helpers.js';

describe('GET /v1/latest', () => {
  let rig: TestRig;
  beforeEach(async () => {
    rig = await boot();
  });
  afterEach(async () => {
    await rig.close();
  });

  it('serves the monthly tier to anonymous callers with a verifiable signature', async () => {
    const res = await fetch(`${rig.baseUrl}/v1/latest`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-catalog-tier')).toBe('monthly');
    expect(res.headers.get('x-catalog-version')).toBe('2026.01.01');

    const bytes = Buffer.from(await res.arrayBuffer());
    const sig = res.headers.get('x-catalog-signature')!;
    const ok = crypto.verify(null, bytes, publicKeyFromPem(rig.publicKeyPem), Buffer.from(sig, 'base64'));
    expect(ok).toBe(true);

    const body = JSON.parse(bytes.toString('utf8')) as { tier: string; version: string };
    expect(body).toMatchObject({ tier: 'monthly', version: '2026.01.01' });
  });

  it('answers 304 when since matches the tier version', async () => {
    const res = await fetch(`${rig.baseUrl}/v1/latest?since=2026.01.01`);
    expect(res.status).toBe(304);
  });

  it('does NOT 304 against the other tier: a lapsed premium client still gets the monthly body', async () => {
    const res = await fetch(`${rig.baseUrl}/v1/latest?since=2026.01.15`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-catalog-tier')).toBe('monthly');
  });

  it('serves the live tier to a valid license, and 304s on the live version', async () => {
    const { key } = issueLicense(rig.db, { email: 'pro@example.com', plan: 'annual', prefix: 'TST' });
    const res = await fetch(`${rig.baseUrl}/v1/latest`, { headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-catalog-tier')).toBe('live');
    expect(res.headers.get('x-catalog-version')).toBe('2026.01.15');

    const cached = await fetch(`${rig.baseUrl}/v1/latest?since=2026.01.15`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(cached.status).toBe(304);
  });

  it('falls back to monthly for unknown, malformed or expired keys — never errors', async () => {
    for (const bearer of ['garbage', 'TST-0000-0000-0000-0000']) {
      const res = await fetch(`${rig.baseUrl}/v1/latest`, { headers: { authorization: `Bearer ${bearer}` } });
      expect(res.headers.get('x-catalog-tier')).toBe('monthly');
    }

    // Expired annual: issued with a period end in the past.
    const { key } = issueLicense(rig.db, {
      email: 'expired@example.com',
      plan: 'annual',
      prefix: 'TST',
      periodEnd: new Date(Date.now() - 86_400_000),
    });
    const res = await fetch(`${rig.baseUrl}/v1/latest`, { headers: { authorization: `Bearer ${key}` } });
    expect(res.headers.get('x-catalog-tier')).toBe('monthly');

    void hashKey; // (kept import honest if future cases use it)
  });

  it('healthz reports published versions', async () => {
    const res = await fetch(`${rig.baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, live: '2026.01.15', monthly: '2026.01.01' });
  });
});
