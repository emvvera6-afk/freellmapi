import { describe, expect, it } from 'vitest';
import { nodeSqliteFactory } from '../../../db/node-sqlite.js';
import { down, up } from '../../../db/migrations/20260927_000001_workspace_profiles.js';

function makeDb() {
  const db = nodeSqliteFactory(':memory:');
  db.exec(`
    CREATE TABLE client_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    CREATE TABLE requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function columns(db: ReturnType<typeof makeDb>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name);
}

describe('workspace profiles migration', () => {
  it('adds member metadata and request attribution idempotently', () => {
    const db = makeDb();
    try {
      up(db);
      up(db);
      expect(columns(db, 'client_profiles')).toEqual(expect.arrayContaining(['email', 'role']));
      expect(columns(db, 'requests')).toContain('client_profile_id');

      db.prepare("INSERT INTO client_profiles (name, email, role) VALUES ('Ana', 'ana@example.com', 'developer')").run();
      db.prepare('INSERT INTO requests (client_profile_id, input_tokens, output_tokens) VALUES (1, 10, 2)').run();
      expect(db.prepare('SELECT client_profile_id FROM requests').get()).toEqual({ client_profile_id: 1 });
    } finally {
      db.close?.();
    }
  });

  it('reverses every schema change', () => {
    const db = makeDb();
    try {
      up(db);
      down(db);
      expect(columns(db, 'client_profiles')).not.toEqual(expect.arrayContaining(['email', 'role']));
      expect(columns(db, 'requests')).not.toContain('client_profile_id');
    } finally {
      db.close?.();
    }
  });
});
