import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { nowIso } from '../utils/time.js';
import { isUuid } from '../utils/uuid.js';

export function getActiveUsersMap(tenantId = '') {
  const where = tenantId
    ? `JOIN tenant_memberships tm ON tm.user_id = u.id
       WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'`
    : `WHERE u.status = 'ACTIVE'`;
  const rows = db
    .prepare(`SELECT u.id, u.email, u.name FROM users u ${where}`)
    .all(...(tenantId ? [tenantId] : []));
  return new Map(rows.map((u) => [u.id, u]));
}

export function normalizeOwnerIds(ownerIds, tenantId = DEFAULT_TENANT_ID) {
  if (!ownerIds) return [];
  const ids = Array.isArray(ownerIds)
    ? ownerIds.map(String).filter(Boolean)
    : [String(ownerIds)].filter(Boolean);
  const valid = [];
  for (const id of ids) {
    const row = db
      .prepare(
        `SELECT u.id
         FROM users u
         JOIN tenant_memberships tm ON tm.user_id = u.id
         WHERE u.id = ? AND tm.tenant_id = ? AND u.status = 'ACTIVE' AND tm.status = 'ACTIVE'`
      )
      .get(id, tenantId);
    if (row) valid.push(id);
  }
  return [...new Set(valid)];
}

export function syncRecordOwners(recordId, tenantId, ownerIds) {
  db.prepare(`DELETE FROM record_owners WHERE record_id = ? AND tenant_id = ?`).run(recordId, tenantId);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO record_owners (record_id, tenant_id, user_id, created_at)
     VALUES (?, ?, ?, ?)`
  );
  const now = nowIso();
  for (const ownerId of normalizeOwnerIds(ownerIds, tenantId)) {
    insert.run(recordId, tenantId, ownerId, now);
  }
}

export function resolveOwnersFromJson(ownerJson, tenantId = '', usersMap) {
  const userMap = usersMap || getActiveUsersMap(tenantId);
  let ids = [];
  try {
    ids = JSON.parse(ownerJson || '[]');
  } catch {
    ids = [];
  }
  if (!Array.isArray(ids)) ids = [ids].filter(Boolean);
  const ownerIds = [];
  const owners = [];
  for (const entry of ids.map(String)) {
    if (isUuid(entry)) {
      const u = userMap.get(entry);
      if (u) {
        ownerIds.push(entry);
        owners.push({
          id: entry,
          name: u.name || u.email,
          email: u.email,
        });
      }
    } else if (entry) {
      ownerIds.push(entry);
      owners.push({ id: entry, name: entry, email: '' });
    }
  }
  return { ownerIds, owners };
}

export function ownerDisplayNames(ownerJson, tenantId = '') {
  const { owners } = resolveOwnersFromJson(ownerJson, tenantId);
  if (!owners.length) return ['Unassigned'];
  return owners.map((o) => o.name || o.email);
}

