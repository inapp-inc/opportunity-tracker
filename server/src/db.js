import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Expected a PostgreSQL connection string.');
}

const worker = new Worker(new URL('./pg-worker.js', import.meta.url));
const resultDir = path.join(os.tmpdir(), 'presales-tracker-pg');
fs.mkdirSync(resultDir, { recursive: true });

function translatePositional(sql, args) {
  const params = [];
  let out = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === "'" && !inDouble) {
      out += char;
      if (inSingle && next === "'") {
        out += next;
        i += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }
    if (char === '"' && !inSingle) {
      out += char;
      inDouble = !inDouble;
      continue;
    }
    if (char === '?' && !inSingle && !inDouble) {
      params.push(args[params.length]);
      out += `$${params.length}`;
    } else {
      out += char;
    }
  }
  return { sql: normalizeSql(out), params };
}

function translateNamed(sql, values) {
  const params = [];
  let out = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === "'" && !inDouble) {
      out += char;
      if (inSingle && next === "'") {
        out += next;
        i += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }
    if (char === '"' && !inSingle) {
      out += char;
      inDouble = !inDouble;
      continue;
    }
    if (char === '@' && !inSingle && !inDouble) {
      const match = /^@([a-zA-Z_][a-zA-Z0-9_]*)/.exec(sql.slice(i));
      if (match) {
        params.push(values[match[1]]);
        out += `$${params.length}`;
        i += match[0].length - 1;
        continue;
      }
    }
    out += char;
  }
  return { sql: normalizeSql(out), params };
}

function normalizeSql(sql) {
  let out = sql.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');
  if (/^\s*INSERT\s+INTO\b/i.test(out) && /\bOR\s+IGNORE\b/i.test(sql) && !/\bON\s+CONFLICT\b/i.test(out)) {
    out = out.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING');
  }
  return out;
}

function execute(sql, params = []) {
  const id = randomUUID();
  const resultPath = path.join(resultDir, `${id}.json`);
  const sharedBuffer = new SharedArrayBuffer(4);
  const status = new Int32Array(sharedBuffer);
  worker.postMessage({ sql, params, resultPath, sharedBuffer });
  Atomics.wait(status, 0, 0);
  const raw = fs.readFileSync(resultPath, 'utf8');
  fs.rmSync(resultPath, { force: true });
  const parsed = JSON.parse(raw);
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

export const db = {
  exec(sql) {
    if (!String(sql).trim()) return;
    execute(sql);
  },
  prepare(sql) {
    return {
      all(...args) {
        const bound = args.length === 1 && isPlainObject(args[0])
          ? translateNamed(sql, args[0])
          : translatePositional(sql, args);
        return execute(bound.sql, bound.params).rows;
      },
      get(...args) {
        const bound = args.length === 1 && isPlainObject(args[0])
          ? translateNamed(sql, args[0])
          : translatePositional(sql, args);
        return execute(bound.sql, bound.params).rows[0];
      },
      run(...args) {
        const bound = args.length === 1 && isPlainObject(args[0])
          ? translateNamed(sql, args[0])
          : translatePositional(sql, args);
        const result = execute(bound.sql, bound.params);
        return { changes: result.rowCount };
      },
    };
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function columnExists(table, col) {
  const row = db
    .prepare(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = ?
         AND column_name = ?
       LIMIT 1`
    )
    .get(table, col);
  return Boolean(row);
}

export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

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
    platform_role TEXT NOT NULL DEFAULT 'NONE',
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

  CREATE TABLE IF NOT EXISTS tenant_field_definitions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    entity TEXT NOT NULL DEFAULT 'opportunity',
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    field_type TEXT NOT NULL,
    options_json TEXT NOT NULL DEFAULT '[]',
    lookup_category TEXT,
    required INTEGER NOT NULL DEFAULT 0,
    show_in_table INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (tenant_id, entity, key),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tenant_memberships (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    role TEXT NOT NULL,
    permissions_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, tenant_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS record_owners (
    record_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (record_id, user_id),
    FOREIGN KEY (record_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_opportunities_due_date ON opportunities(due_date);
  CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
  CREATE INDEX IF NOT EXISTS idx_artifact_opportunity ON artifact_links(opportunity_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idem ON notifications(idempotency_key);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_lookup_category ON lookup_entries(category);
  CREATE INDEX IF NOT EXISTS idx_memberships_user_tenant ON tenant_memberships(user_id, tenant_id);
  CREATE INDEX IF NOT EXISTS idx_memberships_tenant_role ON tenant_memberships(tenant_id, role);
  CREATE INDEX IF NOT EXISTS idx_memberships_tenant_status ON tenant_memberships(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_record_owners_tenant_user ON record_owners(tenant_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_record_owners_tenant_record ON record_owners(tenant_id, record_id);
  `);

  const defaultTenantId = 'default-tenant';
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO tenants (id, name, slug, status, created_at, updated_at)
     VALUES (?, ?, ?, 'ACTIVE', ?, ?)`
  ).run(defaultTenantId, 'Default Team', 'default', now, now);

  const tenantTables = [
    'opportunities',
    'artifact_links',
    'notifications',
    'users',
    'app_config',
    'lookup_entries',
  ];
  for (const table of tenantTables) {
    if (!columnExists(table, 'tenant_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT`);
      db.prepare(`UPDATE ${table} SET tenant_id = ? WHERE tenant_id IS NULL`).run(
        defaultTenantId
      );
    }
  }

  if (!columnExists('users', 'platform_role')) {
    db.exec(`ALTER TABLE users ADD COLUMN platform_role TEXT NOT NULL DEFAULT 'NONE'`);
  }

  if (!columnExists('opportunities', 'archived')) {
    db.exec(
      'ALTER TABLE opportunities ADD COLUMN archived INTEGER NOT NULL DEFAULT 0'
    );
  }
  if (!columnExists('opportunities', 'deal_stage')) {
    db.exec(
      `ALTER TABLE opportunities ADD COLUMN deal_stage TEXT NOT NULL DEFAULT 'Discovery'`
    );
  }
  if (!columnExists('opportunities', 'custom_data_json')) {
    db.exec(
      `ALTER TABLE opportunities ADD COLUMN custom_data_json TEXT NOT NULL DEFAULT '{}'`
    );
  }
  if (!columnExists('opportunities', 'is_draft')) {
    db.exec(
      `ALTER TABLE opportunities ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0`
    );
  }
  if (!columnExists('tenant_field_definitions', 'lookup_category')) {
    db.exec(`ALTER TABLE tenant_field_definitions ADD COLUMN lookup_category TEXT`);
  }

  const appConfigRows = db.prepare(`SELECT key, tenant_id FROM app_config`).all();
  const updateConfigTenant = db.prepare(`UPDATE app_config SET tenant_id = ? WHERE key = ?`);
  for (const row of appConfigRows) {
    const match = /^tenant:([^:]+):/.exec(String(row.key || ''));
    const tenantId = match?.[1] || row.tenant_id || defaultTenantId;
    if (row.tenant_id !== tenantId) updateConfigTenant.run(tenantId, row.key);
  }

  db.exec(`
  CREATE TABLE IF NOT EXISTS opportunity_activities (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    actor_id TEXT,
    actor_email TEXT NOT NULL,
    body TEXT,
    meta_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_opp_activity_opp ON opportunity_activities(opportunity_id);
  CREATE INDEX IF NOT EXISTS idx_opp_activity_created ON opportunity_activities(created_at);
  `);

  if (!columnExists('opportunity_activities', 'tenant_id')) {
    db.exec(`ALTER TABLE opportunity_activities ADD COLUMN tenant_id TEXT`);
    db.prepare(
      `UPDATE opportunity_activities SET tenant_id = ? WHERE tenant_id IS NULL`
    ).run(defaultTenantId);
  }

  db.exec(`
  CREATE INDEX IF NOT EXISTS idx_opportunities_tenant ON opportunities(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_artifact_tenant ON artifact_links(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_lookup_tenant_category ON lookup_entries(tenant_id, category);
  CREATE INDEX IF NOT EXISTS idx_app_config_tenant ON app_config(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_opp_activity_tenant ON opportunity_activities(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_tenant_field_defs ON tenant_field_definitions(tenant_id, entity, sort_order);
  `);

  db.prepare(
    `UPDATE users SET platform_role = 'PLATFORM_ADMIN' WHERE role = 'ADMIN' AND platform_role = 'NONE'`
  ).run();

  const existingUsers = db
    .prepare(`SELECT id, role, tenant_id, created_at, updated_at FROM users`)
    .all();
  const insertMembership = db.prepare(
    `INSERT OR IGNORE INTO tenant_memberships (
      id, user_id, tenant_id, role, permissions_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
  );
  for (const user of existingUsers) {
    const role =
      user.role === 'ADMIN'
        ? 'TENANT_ADMIN'
        : user.role === 'EDITOR'
          ? 'MANAGER'
          : 'VIEWER';
    insertMembership.run(
      `${user.id}:${user.tenant_id || defaultTenantId}`,
      user.id,
      user.tenant_id || defaultTenantId,
      role,
      '[]',
      user.created_at || now,
      user.updated_at || now
    );
  }

  const userIds = new Set(db.prepare(`SELECT id FROM users`).all().map((u) => u.id));
  const ownerRows = db.prepare(`SELECT id, tenant_id, owner_json, created_at FROM opportunities`).all();
  const insertOwner = db.prepare(
    `INSERT OR IGNORE INTO record_owners (record_id, tenant_id, user_id, created_at)
     VALUES (?, ?, ?, ?)`
  );
  for (const row of ownerRows) {
    let ownerIds = [];
    try {
      ownerIds = JSON.parse(row.owner_json || '[]');
    } catch {
      ownerIds = [];
    }
    for (const ownerId of ownerIds) {
      if (typeof ownerId === 'string' && ownerId && userIds.has(ownerId)) {
        insertOwner.run(row.id, row.tenant_id || defaultTenantId, ownerId, row.created_at || now);
      }
    }
  }

  // Add status column to tenant_memberships if missing (pre-existing DBs)
  if (!columnExists('tenant_memberships', 'status')) {
    db.exec(`ALTER TABLE tenant_memberships ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'`);
  }

  // Add permissions_json column to tenant_memberships if missing
  if (!columnExists('tenant_memberships', 'permissions_json')) {
    db.exec(`ALTER TABLE tenant_memberships ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]'`);
  }

  db.prepare(`INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)`).run(
    '2026-05-25-rbac-memberships',
    now
  );

  db.exec(`
  CREATE TABLE IF NOT EXISTS invite_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  `);
}
