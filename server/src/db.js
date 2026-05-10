import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataDir =
  process.env.DATA_DIR ||
  path.join(__dirname, '..', 'data');

fs.mkdirSync(dataDir, { recursive: true });
const dbPath =
  process.env.SQLITE_PATH ||
  path.join(dataDir, 'opportunity-tracking.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function columnExists(table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === col);
}

export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    prospect TEXT NOT NULL,
    opportunity_description TEXT NOT NULL DEFAULT '',
    owner_json TEXT NOT NULL DEFAULT '[]',
    deliverables TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL,
    status TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    win_or_loss TEXT NOT NULL DEFAULT 'Open',
    first_presales_call TEXT,
    closed_date TEXT,
    prospect_type TEXT NOT NULL DEFAULT '',
    engagement_type TEXT NOT NULL DEFAULT '',
    value REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS artifact_links (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    type TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'IN_APP',
    state TEXT NOT NULL DEFAULT 'SENT',
    trigger_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    message TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lookup_entries (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_opportunities_due_date ON opportunities(due_date);
  CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
  CREATE INDEX IF NOT EXISTS idx_artifact_opportunity ON artifact_links(opportunity_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idem ON notifications(idempotency_key);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_lookup_category ON lookup_entries(category);
  `);

  if (!columnExists('opportunities', 'archived')) {
    db.exec(
      'ALTER TABLE opportunities ADD COLUMN archived INTEGER NOT NULL DEFAULT 0'
    );
  }
}
