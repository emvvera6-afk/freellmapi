import crypto from 'crypto';
import type { Db, LicenseRow } from './db.js';
import { getLicenseByHash } from './db.js';

/**
 * License keys look like `PRO-K7Q2-9M4X-JT8C-W3PN`: a brand prefix plus 16
 * Crockford base32 chars (no I/L/O/U confusion, reads well over support
 * chat). 81 bits of entropy — unguessable, short enough to paste.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateLicenseKey(prefix: string): string {
  const bytes = crypto.randomBytes(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let body = '';
  for (let i = 0; i < 16; i++) {
    body = CROCKFORD[Number(bits & 31n)] + body;
    bits >>= 5n;
  }
  const groups = body.match(/.{4}/g)!;
  return `${prefix}-${groups.join('-')}`;
}

export function normalizeKey(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

/** Short human-safe id for orders etc: `ORD-K7Q29M4X`. */
export function publicId(prefix: string): string {
  const bytes = crypto.randomBytes(5);
  let body = '';
  for (const b of bytes) body += CROCKFORD[b % 32];
  return `${prefix}-${body.slice(0, 8)}`;
}

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(normalizeKey(key)).digest('hex');
}

/** `PRO-K7Q2-…-W3PN` — safe to show in support/admin contexts. */
export function keyPreview(key: string): string {
  const parts = normalizeKey(key).split('-');
  if (parts.length < 3) return normalizeKey(key).slice(0, 12) + '…';
  return `${parts[0]}-${parts[1]}-…-${parts[parts.length - 1]}`;
}

export interface LicensePayload {
  valid: boolean;
  plan: 'annual' | 'lifetime' | null;
  status: string | null;
  expiresAt: string | null;
  cancelAtPeriodEnd?: boolean;
  /** unknown_key | expired | canceled | refunded | past_due — the router app
   *  maps these to human messages (server/src/routes/premium.ts). */
  reason?: string;
}

/** Evaluate a DB row into the wire payload the router app expects. */
export function evaluate(row: LicenseRow | null, now: Date = new Date()): LicensePayload {
  if (!row) {
    return { valid: false, plan: null, status: null, expiresAt: null, reason: 'unknown_key' };
  }
  const base = {
    valid: false,
    plan: row.plan,
    status: row.status,
    expiresAt: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
  };
  if (row.status === 'refunded') return { ...base, reason: 'refunded' };
  if (row.status === 'canceled') return { ...base, reason: 'canceled' };
  if (row.status === 'past_due') return { ...base, reason: 'past_due' };
  if (row.plan === 'annual') {
    const end = row.current_period_end ? new Date(row.current_period_end) : null;
    if (!end || end.getTime() <= now.getTime()) {
      return { ...base, reason: 'expired' };
    }
  }
  return { ...base, valid: true };
}

export function issueLicense(
  db: Db,
  args: {
    email: string;
    plan: 'annual' | 'lifetime';
    prefix: string;
    periodEnd?: Date | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeCheckoutSessionId?: string | null;
  },
): { key: string; row: LicenseRow } {
  const key = generateLicenseKey(args.prefix);
  const now = new Date().toISOString();
  const periodEnd =
    args.periodEnd !== undefined
      ? args.periodEnd
      : args.plan === 'annual'
        ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        : null;
  db.prepare(
    `INSERT INTO licenses
       (key_hash, key_preview, email, plan, status, stripe_customer_id,
        stripe_subscription_id, stripe_checkout_session_id, current_period_end,
        cancel_at_period_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    hashKey(key),
    keyPreview(key),
    args.email,
    args.plan,
    args.stripeCustomerId ?? null,
    args.stripeSubscriptionId ?? null,
    args.stripeCheckoutSessionId ?? null,
    periodEnd ? periodEnd.toISOString() : null,
    now,
    now,
  );
  const row = db.prepare('SELECT * FROM licenses WHERE key_hash = ?').get(hashKey(key)) as LicenseRow;
  return { key, row };
}

/** Recovery = rotation: invalidate the old hash, return the replacement key. */
export function rotateLicense(db: Db, oldKeyHash: string, prefix: string): { key: string } | null {
  const existing = getLicenseByHash(db, oldKeyHash);
  if (!existing) return null;
  const key = generateLicenseKey(prefix);
  db.prepare('UPDATE licenses SET key_hash = ?, key_preview = ?, updated_at = ? WHERE key_hash = ?').run(
    hashKey(key),
    keyPreview(key),
    new Date().toISOString(),
    oldKeyHash,
  );
  return { key };
}
