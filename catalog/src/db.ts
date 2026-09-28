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

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'licenses.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
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
