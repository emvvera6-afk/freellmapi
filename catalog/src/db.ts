import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

/**
 * License store. Plain SQLite (better-sqlite3, same as the router) — the
 * whole billing state fits in one file you can `sqlite3` into, back up with
 * `cp`, and inspect during a support ticket.
 *
 * License keys are stored HASHED (sha256). Support-visible identity comes
 * from key_preview (first/last group). Key recovery therefore means
 * ROTATION: we issue a replacement key and the old hash dies — which is the
 * behavior you want anyway if a key leaked.
 */

export type Db = Database.Database;

export interface LicenseRow {
  key_hash: string;
  key_preview: string;
  email: string;
  plan: 'annual' | 'lifetime';
  /** active | past_due | canceled | refunded */
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  /** ISO string; NULL for lifetime plans. */
  current_period_end: string | null;
  cancel_at_period_end: 0 | 1;
  created_at: string;
  updated_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS licenses (
  key_hash TEXT PRIMARY KEY,
  key_preview TEXT NOT NULL,
  email TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('annual','lifetime')),
  status TEXT NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  stripe_checkout_session_id TEXT UNIQUE,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses(email);
CREATE INDEX IF NOT EXISTS idx_licenses_customer ON licenses(stripe_customer_id);

-- Manual-checkout orders (the $0 payment path): a buyer leaves email+plan on
-- /buy, pays USDT/PayPal out of band, and an operator fulfills from
-- /v1/admin/orders → the license is issued and emailed automatically.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('annual','lifetime')),
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','canceled')),
  fulfilled_key_hash TEXT,
  created_at TEXT NOT NULL,
  fulfilled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(dbPath(dataDir));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function dbPath(dataDir: string): string {
  return path.join(dataDir, 'licenses.db');
}

export function getLicenseByHash(db: Db, keyHash: string): LicenseRow | null {
  return (db.prepare('SELECT * FROM licenses WHERE key_hash = ?').get(keyHash) as LicenseRow | undefined) ?? null;
}

export function getLicenseBySessionId(db: Db, sessionId: string): LicenseRow | null {
  return (
    (db.prepare('SELECT * FROM licenses WHERE stripe_checkout_session_id = ?').get(sessionId) as LicenseRow | undefined) ?? null
  );
}

export function getLicenseBySubscriptionId(db: Db, subscriptionId: string): LicenseRow | null {
  return (
    (db.prepare('SELECT * FROM licenses WHERE stripe_subscription_id = ?').get(subscriptionId) as LicenseRow | undefined) ?? null
  );
}

export function getLicensesByCustomer(db: Db, customerId: string): LicenseRow[] {
  return db.prepare('SELECT * FROM licenses WHERE stripe_customer_id = ?').all(customerId) as LicenseRow[];
}

export function getLicensesByEmail(db: Db, email: string): LicenseRow[] {
  return db.prepare('SELECT * FROM licenses WHERE lower(email) = lower(?)').all(email) as LicenseRow[];
}

export function touch(db: Db, keyHash: string): void {
  db.prepare('UPDATE licenses SET updated_at = ? WHERE key_hash = ?').run(new Date().toISOString(), keyHash);
}

/** Webhook idempotency: returns true the first time an event id is seen. */
export function claimStripeEvent(db: Db, eventId: string, type: string): boolean {
  try {
    db.prepare('INSERT INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?)').run(
      eventId,
      type,
      new Date().toISOString(),
    );
    return true;
  } catch {
    return false; // UNIQUE constraint — already processed
  }
}

export function ensureStripeEventsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );
  `);
}

// ── Manual orders ─────────────────────────────────────────────────────────

export interface OrderRow {
  id: string;
  email: string;
  plan: 'annual' | 'lifetime';
  method: string;
  status: 'pending' | 'fulfilled' | 'canceled';
  fulfilled_key_hash: string | null;
  created_at: string;
  fulfilled_at: string | null;
}

export function createOrder(db: Db, order: { id: string; email: string; plan: 'annual' | 'lifetime'; method: string }): OrderRow {
  db.prepare('INSERT INTO orders (id, email, plan, method, created_at) VALUES (?, ?, ?, ?, ?)').run(
    order.id,
    order.email,
    order.plan,
    order.method,
    new Date().toISOString(),
  );
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id) as OrderRow;
}

export function getOrder(db: Db, id: string): OrderRow | null {
  return (db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined) ?? null;
}

export function listOrders(db: Db, status: 'pending' | 'fulfilled' | 'canceled' | null = null): OrderRow[] {
  return status
    ? (db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC').all(status) as OrderRow[])
    : (db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all() as OrderRow[]);
}

export function markOrderFulfilled(db: Db, id: string, keyHash: string): void {
  db.prepare(`UPDATE orders SET status = 'fulfilled', fulfilled_key_hash = ?, fulfilled_at = ? WHERE id = ?`).run(
    keyHash,
    new Date().toISOString(),
    id,
  );
}
