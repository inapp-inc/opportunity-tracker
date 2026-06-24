import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';

function tenantConfigKey(tenantId, key) {
  return `tenant:${tenantId || DEFAULT_TENANT_ID}:${key}`;
}

function globalConfigKey(key) {
  return `global:${key}`;
}

export function getGlobalConfigValue(key, fallback, normalize = (v) => v) {
  const row = db
    .prepare(
      `SELECT value_json FROM app_config
       WHERE key = ? AND (tenant_id IS NULL OR tenant_id = '')
       LIMIT 1`
    )
    .get(globalConfigKey(key));
  if (!row?.value_json) return fallback;
  try {
    const result = normalize(JSON.parse(row.value_json));
    return result == null ? fallback : result;
  } catch {
    return fallback;
  }
}

export function setGlobalConfigValue(key, value) {
  db.prepare(
    `INSERT INTO app_config (key, tenant_id, value_json) VALUES (@key, @tenant_id, @value_json)
     ON CONFLICT(key) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      value_json = excluded.value_json`
  ).run({
    key: globalConfigKey(key),
    tenant_id: '',
    value_json: JSON.stringify(value),
  });
}

export function getConfigValue(tenantId, key, fallback, normalize = (v) => v) {
  const scopedKey = tenantConfigKey(tenantId, key);
  const row = db
    .prepare(
      `SELECT value_json FROM app_config
       WHERE key = ? AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')
       LIMIT 1`
    )
    .get(scopedKey, tenantId || DEFAULT_TENANT_ID);
  if (!row?.value_json) return fallback;
  try {
    const result = normalize(JSON.parse(row.value_json));
    return result == null ? fallback : result;
  } catch {
    return fallback;
  }
}

export function setConfigValue(tenantId, key, value) {
  db.prepare(
    `INSERT INTO app_config (key, tenant_id, value_json) VALUES (@key, @tenant_id, @value_json)
     ON CONFLICT(key) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      value_json = excluded.value_json`
  ).run({
    key: tenantConfigKey(tenantId, key),
    tenant_id: tenantId || DEFAULT_TENANT_ID,
    value_json: JSON.stringify(value),
  });
}

export function ensureConfigValue(tenantId, key, value) {
  const existing = db
    .prepare(
      `SELECT 1 FROM app_config
       WHERE key = ? AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')
       LIMIT 1`
    )
    .get(tenantConfigKey(tenantId, key), tenantId || DEFAULT_TENANT_ID);
  if (!existing) setConfigValue(tenantId, key, value);
}

