/**
 * One-time script: extracts service/startup modules from src/index.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '../src');
const lines = fs.readFileSync(path.join(srcDir, 'index.js'), 'utf8').split('\n');

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function write(rel, header, body, footer = '') {
  const dir = path.dirname(path.join(srcDir, rel));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, rel), `${header}\n${body}\n${footer}`);
  console.log('wrote', rel);
}

// configStorage - base layer
write(
  'services/configStorage.js',
  `import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';

function tenantConfigKey(tenantId, key) {
  return \`tenant:\${tenantId || DEFAULT_TENANT_ID}:\${key}\`;
}

function globalConfigKey(key) {
  return \`global:\${key}\`;
}

export function getGlobalConfigValue(key, fallback, normalize = (v) => v) {
  const row = db
    .prepare(
      \`SELECT value_json FROM app_config
       WHERE key = ? AND (tenant_id IS NULL OR tenant_id = '')
       LIMIT 1\`
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
    \`INSERT INTO app_config (key, tenant_id, value_json) VALUES (@key, @tenant_id, @value_json)
     ON CONFLICT(key) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      value_json = excluded.value_json\`
  ).run({
    key: globalConfigKey(key),
    tenant_id: '',
    value_json: JSON.stringify(value),
  });
}

export function getConfigValue(tenantId, key, fallback, normalize = (v) => v) {
  const row = db
    .prepare(\`SELECT value_json FROM app_config WHERE key = ? LIMIT 1\`)
    .get(tenantConfigKey(tenantId, key));
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
    \`INSERT INTO app_config (key, tenant_id, value_json) VALUES (@key, @tenant_id, @value_json)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json\`
  ).run({
    key: tenantConfigKey(tenantId, key),
    tenant_id: tenantId || DEFAULT_TENANT_ID,
    value_json: JSON.stringify(value),
  });
}

export function ensureConfigValue(tenantId, key, value) {
  const existing = db
    .prepare(\`SELECT 1 FROM app_config WHERE key = ? LIMIT 1\`)
    .get(tenantConfigKey(tenantId, key));
  if (!existing) setConfigValue(tenantId, key, value);
}
`,
  ''
);

console.log('configStorage done');
