import express from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { PERMISSIONS, PLATFORM_ROLES } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import { nowIso } from '../utils/time.js';
import {
  getSettingsPayload,
  setConfigValue,
  setGlobalConfigValue,
  getConfigValue,
  inferReminderOffsets,
  normalizeDashboardConfig,
  resolveDashboardConfig,
  normalizeTerminologyConfig,
  normalizeThemeConfig,
  normalizeListTableLayout,
  normalizeReportsLayout,
  normalizeCaseStudyLayoutValue,
  normalizePageAccessConfigForTenant,
  normalizePlatformRolesConfig,
  normalizeTenantRolePermissionsConfig,
  normalizeSummaryCardsConfig,
} from '../services/configService.js';
import {
  PROTECTED_LOOKUP_CATEGORIES,
  ensureStandardLookupCategories,
  getLookupsPayload,
  getLookupCategoryConfigs,
  lookupCategoryKey,
  lookupCategoryLabel,
} from '../services/lookupService.js';
import {
  getRecordSchemaDefinitions,
  defaultSystemFieldDefinitions,
  getTenantFieldDefinition,
  updateSystemFieldDefinition,
  parseFieldDefinitionInput,
  normalizeFieldOptions,
  allowedFieldTypes,
} from '../services/schemaService.js';

export function createSettingsRouter() {
  const router = express.Router();

router.get('/settings', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_READ), (req, res) => {
  res.json(getSettingsPayload(tenantIdFromReq(req), req.user));
});

router.patch('/settings/my-dashboard', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = req.user?.sub ? String(req.user.sub) : '';
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  const dashboard = normalizeDashboardConfig(req.body?.dashboard || {}, tenantId);
  setConfigValue(tenantId, `user_dashboard:${userId}`, dashboard);
  res.json({ dashboard: resolveDashboardConfig(tenantId, req.user) });
});

router.patch('/settings', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const body = req.body || {};
  const cur = getSettingsPayload(tenantId, req.user);
  const merged = {
    ...cur.notifications,
    ...(body.notifications || {}),
  };
  const notifications = {
    dueSoonThreshold: String(merged.dueSoonThreshold ?? '3'),
    emailEnabled: false,
  };
  const reminderOffsets = Array.isArray(body.reminderOffsets)
    ? body.reminderOffsets.map(Number).filter((n) => !Number.isNaN(n))
    : inferReminderOffsets(String(notifications.dueSoonThreshold ?? '3'));

  setConfigValue(tenantId, 'notification_settings', notifications);
  setConfigValue(tenantId, 'reminder_offsets', reminderOffsets);
  if (body.dashboard) {
    const dashboard = normalizeDashboardConfig({
      ...cur.dashboard,
      ...body.dashboard,
    }, tenantId);
    const scope = String(body.dashboardScope || 'tenant');
    if (scope === 'user' && req.user?.sub) {
      setConfigValue(tenantId, `user_dashboard:${req.user.sub}`, dashboard);
    } else if (scope === 'role') {
      const roleKey = String(body.dashboardRole || req.user?.tenantRole || req.user?.role || 'VIEWER');
      setConfigValue(tenantId, `role_dashboard:${roleKey}`, dashboard);
    } else {
      setConfigValue(tenantId, 'dashboard_config', dashboard);
    }
  }
  if (body.displayTimezone !== undefined) {
    const tz = String(body.displayTimezone || 'UTC').trim() || 'UTC';
    setConfigValue(tenantId, 'display_timezone', tz);
  }
  if (body.terminology) {
    const terminology = normalizeTerminologyConfig({
      ...cur.terminology,
      ...body.terminology,
    });
    setConfigValue(tenantId, 'terminology_config', terminology);
  }
  if (body.theme) {
    const theme = normalizeThemeConfig({
      ...cur.theme,
      ...body.theme,
    });
    setConfigValue(tenantId, 'theme_config', theme);
  }
  if (body.listTableLayout) {
    setConfigValue(
      tenantId,
      'list_table_layout',
      normalizeListTableLayout({
        ...cur.listTableLayout,
        ...body.listTableLayout,
      })
    );
  }
  if (body.reportsLayout) {
    setConfigValue(
      tenantId,
      'reports_layout',
      normalizeReportsLayout({
        ...cur.reportsLayout,
        ...body.reportsLayout,
      })
    );
  }
  if (body.caseStudyEnabled !== undefined) {
    setConfigValue(tenantId, 'case_study_enabled', Boolean(body.caseStudyEnabled));
  }
  if (body.caseStudyLayout !== undefined) {
    const next = normalizeCaseStudyLayoutValue(body.caseStudyLayout);
    setConfigValue(tenantId, 'case_study_layout', next ?? { columns: [] });
  }
  if (body.pageAccess !== undefined) {
    const next = normalizePageAccessConfigForTenant({
      ...cur.pageAccess,
      ...body.pageAccess,
    }, tenantId);
    setConfigValue(tenantId, 'page_access_config', next);
  }
  if (body.platformRoles !== undefined) {
    if (String(req.user?.platformRole || PLATFORM_ROLES.NONE) !== PLATFORM_ROLES.PLATFORM_ADMIN) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const next = normalizePlatformRolesConfig(body.platformRoles);
    setGlobalConfigValue('platform_roles_config', next);
  }
  if (body.tenantRolePermissions !== undefined) {
    const next = normalizeTenantRolePermissionsConfig(body.tenantRolePermissions, tenantId);
    setConfigValue(tenantId, 'tenant_role_permissions_config', next);
  }
  if (body.summaryCards !== undefined) {
    const next = normalizeSummaryCardsConfig(body.summaryCards);
    setConfigValue(tenantId, 'summary_cards_config', next);
  }
  res.json(getSettingsPayload(tenantId, req.user));
});
router.get('/catalog/lookups', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  ensureStandardLookupCategories(tenantId);
  const payload = getLookupsPayload(tenantId);
  const settings = getSettingsPayload(tenantId, req.user);
  const displayTimezone = getConfigValue(
    tenantId,
    'display_timezone',
    'UTC',
    (parsed) => String(parsed || 'UTC')
  );
  res.json({
    artifactTypes: payload.artifactTypes,
    prospectTypes: payload.prospectTypes,
    engagementTypes: payload.engagementTypes,
    deliverables: payload.deliverables,
    currencies: payload.currencies,
    dealStages: payload.dealStages,
    winLoss: payload.winLoss,
    displayTimezone,
    caseStudyEnabled: settings.caseStudyEnabled,
    caseStudyLayout: settings.caseStudyLayout,
    pageAccess: settings.pageAccess,
  });
});
router.get('/settings/lookups', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_READ), (req, res) => {
  res.json(getLookupsPayload(tenantIdFromReq(req)));
});

router.post('/settings/lookups', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const category = lookupCategoryKey(req.body?.category || req.body?.categoryName);
  const value = String(req.body?.value || '').trim();
  if (!category) return res.status(400).json({ message: 'category required' });
  if (!value) return res.status(400).json({ message: 'value required' });
  const maxSort =
    db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS m FROM lookup_entries WHERE tenant_id = ? AND category = ?`
      )
      .get(tenantId, category).m + 1;
  const id = randomUUID();
  db.prepare(
    `INSERT INTO lookup_entries (id, tenant_id, category, value, sort_order) VALUES (?, ?, ?, ?, ?)`
  ).run(id, tenantId, category, value, maxSort);
  res.status(201).json({ id, category, value, sortOrder: maxSort });
});

router.post('/settings/lookups/categories', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const category = lookupCategoryKey(req.body?.category || req.body?.name);
  if (!category) return res.status(400).json({ message: 'category required' });
  const categories = getLookupCategoryConfigs(tenantId);
  if (!categories.some((item) => item.category === category)) {
    categories.push({ category, label: lookupCategoryLabel(category) });
    setConfigValue(tenantId, 'lookup_categories', categories);
  }
  res.status(201).json({ category, label: lookupCategoryLabel(category), items: [] });
});

const PROTECTED_LOOKUP_CATEGORIES = new Set([
  'DEAL_STAGE',
  'DELIVERABLES',
  'ENGAGEMENT_TYPE',
  'PROSPECT_TYPE',
  'WIN_LOSS',
  'ARTIFACT_TYPE',
  'CURRENCY',
]);

router.delete(
  '/settings/lookups/categories/:category',
  requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE),
  (req, res) => {
    const tenantId = tenantIdFromReq(req);
    const category = lookupCategoryKey(req.params.category);
    if (!category) return res.status(400).json({ message: 'category required' });
    if (PROTECTED_LOOKUP_CATEGORIES.has(category)) {
      return res.status(400).json({ message: 'This lookup category cannot be removed' });
    }
    const categories = getLookupCategoryConfigs(tenantId);
    const nextCategories = categories.filter((item) => item.category !== category);
    const removed = db
      .prepare('DELETE FROM lookup_entries WHERE tenant_id = ? AND category = ?')
      .run(tenantId, category);
    if (nextCategories.length === categories.length && removed.changes === 0) {
      return res.status(404).json({ message: 'Not found' });
    }
    setConfigValue(tenantId, 'lookup_categories', nextCategories);
    res.status(204).send();
  }
);

router.patch('/settings/lookups/:id', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const value = String(req.body?.value || '').trim();
  if (!value) return res.status(400).json({ message: 'value required' });
  const existing = db
    .prepare('SELECT id, category, value, sort_order FROM lookup_entries WHERE id = ? AND tenant_id = ?')
    .get(req.params.id, tenantId);
  if (!existing) return res.status(404).json({ message: 'Not found' });
  const prevValue = String(existing.value || '');
  db.prepare('UPDATE lookup_entries SET value = ? WHERE id = ? AND tenant_id = ?').run(
    value,
    req.params.id,
    tenantId
  );
  // Propagate lookup edits to existing records that store the lookup value directly.
  // (Records store the lookup entry's `value` string, not an ID.)
  const category = String(existing.category || '');
  const propagate = (col) => {
    if (!prevValue || prevValue === value) return;
    db.prepare(
      `UPDATE opportunities
       SET ${col} = ?
       WHERE tenant_id = ? AND ${col} = ?`
    ).run(value, tenantId, prevValue);
  };
  if (category === 'WIN_LOSS') propagate('win_or_loss');
  if (category === 'DEAL_STAGE') propagate('deal_stage');
  if (category === 'PROSPECT_TYPE') propagate('prospect_type');
  if (category === 'ENGAGEMENT_TYPE') propagate('engagement_type');
  if (category === 'CURRENCY') propagate('currency');
  res.json({
    id: existing.id,
    category: existing.category,
    value,
    sortOrder: existing.sort_order,
  });
});

router.delete('/settings/lookups/:id', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const r = db
    .prepare('DELETE FROM lookup_entries WHERE id = ? AND tenant_id = ?')
    .run(req.params.id, tenantId);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
});

router.get('/settings/schema', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_READ), (req, res) => {
  res.json({ fields: getRecordSchemaDefinitions(tenantIdFromReq(req)) });
});

// Read-only schema access for non-admin users (Dashboard, reports, etc.)
router.get('/catalog/schema', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  res.json({ fields: getRecordSchemaDefinitions(tenantIdFromReq(req)) });
});

router.post('/settings/schema', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const parsed = parseFieldDefinitionInput(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const systemKeys = new Set(defaultSystemFieldDefinitions().map((f) => f.key));
  if (systemKeys.has(parsed.field.key)) {
    return res.status(409).json({
      message: `Field key "${parsed.field.key}" is reserved by a built-in field. Choose a different key.`,
    });
  }
  const exists = db
    .prepare(
      `SELECT id FROM tenant_field_definitions WHERE tenant_id = ? AND entity = 'opportunity' AND key = ?`
    )
    .get(tenantId, parsed.field.key);
  if (exists) return res.status(409).json({ message: 'Field key already exists' });
  const maxSort =
    db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS m
         FROM tenant_field_definitions WHERE tenant_id = ? AND entity = 'opportunity'`
      )
      .get(tenantId).m + 1;
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO tenant_field_definitions (
      id, tenant_id, entity, key, label, field_type, options_json, lookup_category,
      required, show_in_table, sort_order, status, created_at, updated_at
    ) VALUES (
      @id, @tenant_id, 'opportunity', @key, @label, @field_type, @options_json, @lookup_category,
      @required, @show_in_table, @sort_order, 'ACTIVE', @created_at, @updated_at
    )`
  ).run({
    id,
    tenant_id: tenantId,
    ...parsed.field,
    sort_order: maxSort,
    created_at: now,
    updated_at: now,
  });
  res.status(201).json(getTenantFieldDefinition(tenantId, id));
});

router.patch('/settings/schema/:id', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  if (String(req.params.id).startsWith('system:')) {
    try {
      const saved = updateSystemFieldDefinition(
        tenantId,
        String(req.params.id).replace(/^system:/, ''),
        req.body || {}
      );
      if (!saved) return res.status(404).json({ message: 'Not found' });
      return res.json(saved);
    } catch (e) {
      return res.status(400).json({ message: e instanceof Error ? e.message : 'invalid field' });
    }
  }
  const existing = getTenantFieldDefinition(tenantId, req.params.id);
  if (!existing) return res.status(404).json({ message: 'Not found' });
  const body = req.body || {};
  const patch = {
    label: body.label !== undefined ? String(body.label).trim() : existing.label,
    field_type:
      body.fieldType !== undefined ? String(body.fieldType) : existing.fieldType,
    options_json:
      body.options !== undefined
        ? JSON.stringify(normalizeFieldOptions(body.options))
        : JSON.stringify(existing.options || []),
    lookup_category:
      body.lookupCategory !== undefined
        ? lookupCategoryKey(body.lookupCategory)
        : existing.lookupCategory || null,
    required:
      body.required !== undefined ? (body.required ? 1 : 0) : existing.required ? 1 : 0,
    show_in_table:
      body.showInTable !== undefined
        ? body.showInTable
          ? 1
          : 0
        : existing.showInTable
          ? 1
          : 0,
    status: body.status !== undefined ? String(body.status) : existing.status,
    sort_order:
      body.sortOrder !== undefined ? Number(body.sortOrder) : Number(existing.sortOrder || 0),
  };
  if (!patch.label) return res.status(400).json({ message: 'label required' });
  if (!allowedFieldTypes().includes(patch.field_type)) {
    return res.status(400).json({ message: 'invalid fieldType' });
  }
  const nextOptions = normalizeFieldOptions(JSON.parse(patch.options_json || '[]'));
  if (
    ['select', 'multi_select', 'lookup_select', 'lookup_multi_select'].includes(patch.field_type) &&
    !nextOptions.length &&
    !patch.lookup_category
  ) {
    return res.status(400).json({ message: 'choice fields require options or lookup source' });
  }
  if (!['ACTIVE', 'INACTIVE'].includes(patch.status)) {
    return res.status(400).json({ message: 'invalid status' });
  }
  db.prepare(
    `UPDATE tenant_field_definitions SET
      label = @label,
      field_type = @field_type,
      options_json = @options_json,
      lookup_category = @lookup_category,
      required = @required,
      show_in_table = @show_in_table,
      status = @status,
      sort_order = @sort_order,
      updated_at = @updated_at
     WHERE id = @id AND tenant_id = @tenant_id`
  ).run({
    id: req.params.id,
    tenant_id: tenantId,
    ...patch,
    updated_at: nowIso(),
  });
  res.json(getTenantFieldDefinition(tenantId, req.params.id));
});

router.delete('/settings/schema/:id', requireTenantPermission(PERMISSIONS.TENANT_SETTINGS_WRITE), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  if (String(req.params.id).startsWith('system:')) {
    const saved = updateSystemFieldDefinition(
      tenantId,
      String(req.params.id).replace(/^system:/, ''),
      { status: 'INACTIVE' }
    );
    if (!saved) return res.status(404).json({ message: 'Not found' });
    return res.status(204).send();
  }
  db.prepare(
    `UPDATE tenant_field_definitions
     SET status = 'INACTIVE', updated_at = ?
     WHERE id = ? AND tenant_id = ?`
  ).run(nowIso(), req.params.id, tenantId);
  res.status(204).send();
});
  return router;
}

