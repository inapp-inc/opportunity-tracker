import { randomUUID } from 'crypto';
import { db } from '../db.js';
import {
  DEFAULT_TENANT_ID,
  STATIC_AUTH_EMAIL,
  STATIC_AUTH_PASSWORD,
} from '../constants.js';
import { hashPassword } from '../auth-utils.js';
import { nowIso } from '../utils/time.js';
import {
  ensureStandardLookupCategories,
  defaultLookupCategories,
} from '../services/lookupService.js';
import {
  ensureConfigValue,
  defaultDashboardConfig,
  normalizeListTableLayout,
  normalizeReportsLayout,
  defaultTerminologyConfig,
  defaultThemeConfig,
  inferReminderOffsets,
} from '../services/configService.js';
import { syncRecordOwners } from '../services/ownerService.js';

export function seedIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM opportunities').get().c;
  if (n > 0) return;
  const now = nowIso();
  const admin =
    db
      .prepare(
        `SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1`
      )
      .get() ||
    db.prepare(`SELECT id FROM users WHERE status = 'ACTIVE' LIMIT 1`).get();
  const ownerId = admin?.id;
  if (!ownerId) return;
  const samples = [
    {
      prospect: 'Acme Corporation',
      opportunity_description: 'Enterprise Cloud Migration',
      owner: [ownerId],
      deliverables: 'Migration Plan, ROI Analysis',
      due_date: '2026-04-30',
      status: 'In Progress',
      prospect_type: 'Enterprise',
      engagement_type: 'RFP',
      value: 150000,
    },
    {
      prospect: 'GlobalTech Inc',
      opportunity_description: 'AI Platform Integration',
      owner: [ownerId],
      deliverables: 'Technical Architecture, Demo',
      due_date: '2026-05-15',
      status: 'In Progress',
      prospect_type: 'Enterprise',
      engagement_type: 'POC',
      value: 200000,
    },
    {
      prospect: 'StartupX',
      opportunity_description: 'Product Evaluation',
      owner: [ownerId],
      deliverables: 'Feature Demo, Pricing Proposal',
      due_date: '2026-05-01',
      status: 'Not Started',
      prospect_type: 'SMB',
      engagement_type: 'Demo',
      value: 25000,
    },
  ];
  const ins = db.prepare(
    `INSERT INTO opportunities (
      id, tenant_id, prospect, opportunity_description, owner_json, deliverables, due_date, status, notes,
      win_or_loss, first_presales_call, closed_date, prospect_type, engagement_type,
      value, currency, deal_stage, version, archived, created_at, updated_at
    ) VALUES (
      @id, @tenant_id, @prospect, @opportunity_description, @owner_json, @deliverables, @due_date, @status, @notes,
      @win_or_loss, @first_presales_call, @closed_date, @prospect_type, @engagement_type,
      @value, @currency, @deal_stage, @version, @archived, @created_at, @updated_at
    )`
  );

  for (const s of samples) {
    const id = randomUUID();
    ins.run({
      id,
      tenant_id: DEFAULT_TENANT_ID,
      prospect: s.prospect,
      opportunity_description: s.opportunity_description,
      owner_json: JSON.stringify(s.owner),
      deliverables: s.deliverables,
      due_date: s.due_date,
      status: s.status,
      notes: '',
      win_or_loss: 'Open',
      first_presales_call: null,
      closed_date: null,
      prospect_type: s.prospect_type,
      engagement_type: s.engagement_type,
      value: s.value,
      currency: 'USD',
      deal_stage: 'Discovery',
      version: 1,
      archived: 0,
      created_at: now,
      updated_at: now,
    });
    syncRecordOwners(id, DEFAULT_TENANT_ID, s.owner);
  }
}

export function seedUsersIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (n > 0) return;
  const now = nowIso();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, platform_role, status, created_at, updated_at)
     VALUES (@id, @tenant_id, @email, @password_hash, @name, 'VIEWER', 'PLATFORM_ADMIN', 'ACTIVE', @created_at, @updated_at)`
  ).run({
    id,
    tenant_id: DEFAULT_TENANT_ID,
    email: STATIC_AUTH_EMAIL.toLowerCase(),
    password_hash: hashPassword(STATIC_AUTH_PASSWORD),
    name: 'Administrator',
    created_at: now,
    updated_at: now,
  });
}

export function ensureDefaultPlatformAdminOnly() {
  const email = STATIC_AUTH_EMAIL.toLowerCase();
  const user = db.prepare(`SELECT id FROM users WHERE lower(email) = ?`).get(email);
  if (!user) return;
  db.prepare(
    `UPDATE users
     SET role = 'VIEWER', platform_role = 'PLATFORM_ADMIN', updated_at = ?
     WHERE id = ?`
  ).run(nowIso(), user.id);
  db.prepare(`DELETE FROM tenant_memberships WHERE user_id = ?`).run(user.id);
}

export function seedDealStagesIfEmpty() {
  const n = db
    .prepare(
      `SELECT COUNT(*) AS c FROM lookup_entries WHERE tenant_id = ? AND category = 'DEAL_STAGE'`
    )
    .get(DEFAULT_TENANT_ID).c;
  if (n > 0) return;
  const defaults = [
    ['DEAL_STAGE', 'Discovery', 0],
    ['DEAL_STAGE', 'Qualification', 1],
    ['DEAL_STAGE', 'Solutioning', 2],
    ['DEAL_STAGE', 'Proposal', 3],
    ['DEAL_STAGE', 'Negotiation', 4],
    ['DEAL_STAGE', 'Closed', 5],
  ];
  const ins = db.prepare(
    `INSERT INTO lookup_entries (id, tenant_id, category, value, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  for (const [cat, val, ord] of defaults) {
    ins.run(randomUUID(), DEFAULT_TENANT_ID, cat, val, ord);
  }
}

export function seedLookupsIfEmpty() {
  const n = db
    .prepare('SELECT COUNT(*) AS c FROM lookup_entries WHERE tenant_id = ?')
    .get(DEFAULT_TENANT_ID).c;
  if (n > 0) return;
  const defaults = [
    ['DELIVERABLES', 'Proposal', 0],
    ['DELIVERABLES', 'Demo', 1],
    ['DELIVERABLES', 'POC', 2],
    ['DELIVERABLES', 'Technical Architecture', 3],
    ['DELIVERABLES', 'ROI Analysis', 4],
    ['PROSPECT_TYPE', 'Enterprise', 0],
    ['PROSPECT_TYPE', 'Mid-Market', 1],
    ['PROSPECT_TYPE', 'SMB', 2],
    ['ENGAGEMENT_TYPE', 'RFP', 0],
    ['ENGAGEMENT_TYPE', 'POC', 1],
    ['ENGAGEMENT_TYPE', 'Demo', 2],
    ['ENGAGEMENT_TYPE', 'Consultation', 3],
    ['DEAL_STAGE', 'Discovery', 0],
    ['DEAL_STAGE', 'Qualification', 1],
    ['DEAL_STAGE', 'Solutioning', 2],
    ['DEAL_STAGE', 'Proposal', 3],
    ['DEAL_STAGE', 'Negotiation', 4],
    ['DEAL_STAGE', 'Closed', 5],
  ];
  const ins = db.prepare(
    `INSERT INTO lookup_entries (id, tenant_id, category, value, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  for (const [cat, val, ord] of defaults) {
    ins.run(randomUUID(), DEFAULT_TENANT_ID, cat, val, ord);
  }
}

export function seedDefaultAppConfigIfEmpty() {
  seedTenantDefaults(DEFAULT_TENANT_ID);
}

export function seedTenantDefaults(tenantId) {
  ensureStandardLookupCategories(tenantId);
  const notifications = {
    dueSoonThreshold: '3',
    emailEnabled: false,
  };
  ensureConfigValue(tenantId, 'case_study_enabled', true);
  ensureConfigValue(tenantId, 'notification_settings', notifications);
  ensureConfigValue(
    tenantId,
    'reminder_offsets',
    inferReminderOffsets(notifications.dueSoonThreshold)
  );
  ensureConfigValue(tenantId, 'dashboard_config', defaultDashboardConfig());
  ensureConfigValue(tenantId, 'list_table_layout', normalizeListTableLayout(null));
  ensureConfigValue(tenantId, 'reports_layout', normalizeReportsLayout(null));
  ensureConfigValue(tenantId, 'terminology_config', defaultTerminologyConfig());
  ensureConfigValue(tenantId, 'theme_config', defaultThemeConfig());
  ensureConfigValue(tenantId, 'lookup_categories', defaultLookupCategories());
  const existingLookups = db
    .prepare(`SELECT COUNT(*) AS c FROM lookup_entries WHERE tenant_id = ?`)
    .get(tenantId).c;
  if (existingLookups > 0) return;
  const defaults = [
    ['DELIVERABLES', 'Proposal', 0],
    ['DELIVERABLES', 'Demo', 1],
    ['DELIVERABLES', 'POC', 2],
    ['DELIVERABLES', 'Technical Architecture', 3],
    ['DELIVERABLES', 'ROI Analysis', 4],
    ['PROSPECT_TYPE', 'Enterprise', 0],
    ['PROSPECT_TYPE', 'Mid-Market', 1],
    ['PROSPECT_TYPE', 'SMB', 2],
    ['ENGAGEMENT_TYPE', 'RFP', 0],
    ['ENGAGEMENT_TYPE', 'POC', 1],
    ['ENGAGEMENT_TYPE', 'Demo', 2],
    ['ENGAGEMENT_TYPE', 'Consultation', 3],
    ['DEAL_STAGE', 'Discovery', 0],
    ['DEAL_STAGE', 'Qualification', 1],
    ['DEAL_STAGE', 'Solutioning', 2],
    ['DEAL_STAGE', 'Proposal', 3],
    ['DEAL_STAGE', 'Negotiation', 4],
    ['DEAL_STAGE', 'Closed', 5],
    ['ARTIFACT_TYPE', 'Proposal', 0],
    ['ARTIFACT_TYPE', 'SOW', 1],
    ['ARTIFACT_TYPE', 'Presentation Deck', 2],
    ['CURRENCY', 'USD', 0],
    ['CURRENCY', 'EUR', 1],
    ['CURRENCY', 'GBP', 2],
    ['CURRENCY', 'CAD', 3],
  ];
  const ins = db.prepare(
    `INSERT INTO lookup_entries (id, tenant_id, category, value, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  for (const [cat, val, ord] of defaults) {
    ins.run(randomUUID(), tenantId, cat, val, ord);
  }
}

