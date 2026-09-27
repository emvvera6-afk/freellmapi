// Migration: workspace metadata and per-profile request attribution
// Created: 2026-09-27
//
// DOWN: reversible
//
// Client profiles started as power-user API keys. Muxora's workspace promotes
// them to first-class member/service access, so each row gains optional contact
// metadata and a role. Requests also record the profile that authenticated the
// inference call, enabling private, per-member usage totals without storing
// prompts or plaintext credentials.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some(row => row.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'client_profiles', 'email')) {
    db.prepare('ALTER TABLE client_profiles ADD COLUMN email TEXT').run();
  }
  if (!hasColumn(db, 'client_profiles', 'role')) {
    db.prepare("ALTER TABLE client_profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'member'").run();
  }
  if (!hasColumn(db, 'requests', 'client_profile_id')) {
    db.prepare('ALTER TABLE requests ADD COLUMN client_profile_id INTEGER').run();
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_requests_client_profile_created
      ON requests(client_profile_id, created_at);
  `);
}

export function down(db: Db): void {
  db.exec('DROP INDEX IF EXISTS idx_requests_client_profile_created;');
  if (hasColumn(db, 'requests', 'client_profile_id')) {
    db.prepare('ALTER TABLE requests DROP COLUMN client_profile_id').run();
  }
  if (hasColumn(db, 'client_profiles', 'role')) {
    db.prepare('ALTER TABLE client_profiles DROP COLUMN role').run();
  }
  if (hasColumn(db, 'client_profiles', 'email')) {
    db.prepare('ALTER TABLE client_profiles DROP COLUMN email').run();
  }
}
