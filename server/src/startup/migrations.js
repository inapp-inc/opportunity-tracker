import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { isUuid } from '../utils/uuid.js';
import { getRecordFormFieldConfig, setRecordFormFieldConfig } from '../services/schemaService.js';

export function migrateRetiredCaseStudySchemaFields() {
  const retiredKeys = [
    'buildDays',
    'tokenUsage',
    'aiCostUsd',
    'token_usage',
    'ai_cost',
  ];
  const tenants = db.prepare(`SELECT id FROM tenants`).all();
  const deleteFieldDef = db.prepare(
    `DELETE FROM tenant_field_definitions
     WHERE tenant_id = ? AND entity = 'opportunity' AND key = ?`
  );
  const updateOpp = db.prepare(
    `UPDATE opportunities SET custom_data_json = ?, updated_at = ? WHERE id = ?`
  );

  for (const tenant of tenants) {
    const tenantId = tenant.id;
    const formConfig = getRecordFormFieldConfig(tenantId);
    let formChanged = false;
    for (const key of retiredKeys) {
      if (formConfig[key]) {
        delete formConfig[key];
        formChanged = true;
      }
    }
    if (formChanged) setRecordFormFieldConfig(tenantId, formConfig);

    for (const key of retiredKeys) {
      deleteFieldDef.run(tenantId, key);
    }

    const rows = db
      .prepare(
        `SELECT id, custom_data_json FROM opportunities WHERE tenant_id = ?`
      )
      .all(tenantId);
    const now = new Date().toISOString();
    for (const row of rows) {
      let customFields = {};
      try {
        customFields = JSON.parse(row.custom_data_json || '{}');
      } catch {
        customFields = {};
      }
      let changed = false;
      for (const key of retiredKeys) {
        if (Object.prototype.hasOwnProperty.call(customFields, key)) {
          delete customFields[key];
          changed = true;
        }
      }
      if (changed) {
        updateOpp.run(JSON.stringify(customFields), now, row.id);
      }
    }
  }
}

export function migrateLegacyOwnerIds() {
  const rows = db.prepare('SELECT id, tenant_id, owner_json FROM opportunities').all();
  const upd = db.prepare('UPDATE opportunities SET owner_json = ? WHERE id = ?');
  for (const row of rows) {
    const tenantId = row.tenant_id || DEFAULT_TENANT_ID;
    const users = db
      .prepare(
        `SELECT u.id, u.email, u.name
         FROM users u
         JOIN tenant_memberships tm ON tm.user_id = u.id
         WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'`
      )
      .all(tenantId);
    const byName = new Map();
    for (const u of users) {
      if (u.name) byName.set(String(u.name).toLowerCase(), u.id);
      byName.set(String(u.email).toLowerCase(), u.id);
    }
    const fallback = users[0]?.id;
    let raw = [];
    try {
      raw = JSON.parse(row.owner_json || '[]');
    } catch {
      raw = [];
    }
    if (!Array.isArray(raw)) raw = [raw].filter(Boolean);
    const next = [];
    let changed = false;
    for (const entry of raw.map(String)) {
      if (isUuid(entry)) {
        next.push(entry);
        if (!users.some((u) => u.id === entry)) changed = true;
      } else {
        const id = byName.get(entry.toLowerCase()) || fallback;
        if (id) {
          next.push(id);
          changed = true;
        }
      }
    }
    if (!next.length && fallback) {
      next.push(fallback);
      changed = true;
    }
    const deduped = [...new Set(next)];
    if (changed || JSON.stringify(deduped) !== JSON.stringify(raw)) {
      upd.run(JSON.stringify(deduped), row.id);
    }
  }
}

