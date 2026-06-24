import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { PERMISSIONS, ROLE_PERMISSIONS, TENANT_ROLES, tenantRoleFromLegacyRole } from '../rbac.js';
import { slugify } from '../utils/slug.js';
import {
  getConfigValue,
  setConfigValue,
  ensureConfigValue,
  getGlobalConfigValue,
  setGlobalConfigValue,
} from './configStorage.js';
import { ensureStandardLookupCategories } from './lookupService.js';

export function inferReminderOffsets(thresholdStr) {
  const t = Number(thresholdStr);
  const set = new Set([7, 1, 0]);
  if (!Number.isNaN(t) && t >= 0) set.add(t);
  return [...set].sort((a, b) => b - a);
}

export function defaultDashboardConfig() {
  return {
    title: 'Dashboard',
    subtitle: "Welcome back! Here's your workspace overview.",
    widgets: [
      {
        id: 'total-records',
        title: 'Visible Records',
        type: 'metric_count',
      },
      {
        id: 'total-value',
        title: 'Total Value',
        type: 'metric_sum',
        field: 'value',
      },
      {
        id: 'by-status',
        title: 'Records by Status',
        type: 'bar',
        field: 'status',
      },
      {
        id: 'by-stage',
        title: 'Records by Stage',
        type: 'pie',
        field: 'dealStage',
      },
    ],
  };
}

export function defaultTerminologyConfig() {
  return {
    appName: 'Opportunity Tracker',
    recordSingular: 'Record',
    recordPlural: 'Records',
    recordDescription: 'Track work items, projects, opportunities, or engagements.',
    dashboardLabel: 'Dashboard',
  };
}

export function normalizeTerminologyConfig(input) {
  const defaults = defaultTerminologyConfig();
  const src = input && typeof input === 'object' ? input : {};
  const clean = (key, max) => {
    const value = String(src[key] || defaults[key]).trim().slice(0, max);
    return value || defaults[key];
  };
  return {
    appName: clean('appName', 80),
    recordSingular: clean('recordSingular', 40),
    recordPlural: clean('recordPlural', 40),
    recordDescription: clean('recordDescription', 180),
    dashboardLabel: clean('dashboardLabel', 40),
  };
}

export function defaultPageAccessConfig() {
  return {
    pages: [
      'dashboard',
      'records',
      'opportunities',
      'artifacts',
      'caseStudies',
      'notifications',
      'reports',
      'settings',
    ],
    // v2 shape: pages -> { read, write } per role.
    // v1 legacy shape: role -> string[] pages is migrated in normalizePageAccessConfig.
    roles: {
      TENANT_ADMIN: {
        dashboard: { read: true, write: false },
        records: { read: true, write: true },
        opportunities: { read: true, write: false },
        artifacts: { read: true, write: true },
        caseStudies: { read: true, write: false },
        notifications: { read: true, write: false },
        reports: { read: true, write: false },
        settings: { read: true, write: true },
      },
      MANAGER: {
        dashboard: { read: true, write: false },
        records: { read: true, write: true },
        opportunities: { read: true, write: false },
        artifacts: { read: true, write: true },
        caseStudies: { read: true, write: false },
        notifications: { read: true, write: false },
        reports: { read: true, write: false },
        settings: { read: false, write: false },
      },
      VIEWER: {
        dashboard: { read: true, write: false },
        records: { read: true, write: false },
        opportunities: { read: true, write: false },
        artifacts: { read: true, write: false },
        caseStudies: { read: true, write: false },
        notifications: { read: true, write: false },
        reports: { read: true, write: false },
        settings: { read: false, write: false },
      },
    },
  };
}

export function defaultPlatformRolesConfig() {
  return {
    roles: [
      { key: 'TENANT_ADMIN', label: 'Workspace Admin' },
      { key: 'MANAGER', label: 'Manager' },
      { key: 'VIEWER', label: 'Viewer' },
    ],
  };
}

export function normalizePlatformRolesConfig(input) {
  const defaults = defaultPlatformRolesConfig();
  const src = input && typeof input === 'object' ? input : {};
  const raw = Array.isArray(src.roles) ? src.roles : [];
  const seen = new Set();
  const roles = raw
    .filter((r) => r && typeof r === 'object')
    .map((r, idx) => {
      const fallback = defaults.roles[idx] || defaults.roles[0];
      const key = String(r.key || fallback.key || `ROLE_${idx + 1}`)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
      const label =
        String(r.label || fallback.label || key)
          .trim()
          .slice(0, 40) || key;
      return {
        key: key || fallback.key,
        label,
      };
    })
    .filter((r) => {
      if (!r.key) return false;
      if (seen.has(r.key)) return false;
      seen.add(r.key);
      return true;
    });
  // Ensure core roles always exist.
  for (const core of defaults.roles) {
    if (!seen.has(core.key)) roles.push(core);
  }
  return { roles };
}

export function getPlatformRolesConfig() {
  const base = getGlobalConfigValue(
    'platform_roles_config',
    defaultPlatformRolesConfig(),
    normalizePlatformRolesConfig
  );

  // Backward compatibility: older builds stored roles per-tenant under `tenant:*:tenant_roles_config`.
  // If a platform admin created roles previously (e.g. ROLE_4), we merge them into the platform catalog
  // so memberships don’t start failing after the platform-wide refactor.
  let legacy = [];
  try {
    const rows = db
      .prepare(`SELECT value_json FROM app_config WHERE key LIKE 'tenant:%:tenant_roles_config'`)
      .all();
    for (const row of rows) {
      if (!row?.value_json) continue;
      try {
        const parsed = normalizePlatformRolesConfig(JSON.parse(row.value_json));
        legacy.push(...(parsed?.roles || []));
      } catch {
        // ignore malformed legacy rows
      }
    }
  } catch {
    legacy = [];
  }

  if (!legacy.length) return base;

  const merged = normalizePlatformRolesConfig({
    roles: [...(base.roles || []), ...legacy],
  });

  // Persist merged catalog once so future reads are consistent.
  try {
    setGlobalConfigValue('platform_roles_config', merged);
  } catch {
    // ignore write errors; we still return merged for this request.
  }
  return merged;
}

export function isAllowedPlatformRole(roleKey) {
  const rolesCfg = getPlatformRolesConfig();
  return Boolean((rolesCfg.roles || []).some((r) => r.key === roleKey));
}

export function tenantRoleKeyFromLegacyRole(role) {
  return tenantRoleFromLegacyRole(role);
}

export function defaultTenantRolePermissionsConfig() {
  return {
    roles: {
      TENANT_ADMIN: ROLE_PERMISSIONS[TENANT_ROLES.TENANT_ADMIN],
      MANAGER: ROLE_PERMISSIONS[TENANT_ROLES.MANAGER],
      VIEWER: ROLE_PERMISSIONS[TENANT_ROLES.VIEWER],
    },
  };
}

export function normalizeTenantRolePermissionsConfig(input, tenantId) {
  const defaults = defaultTenantRolePermissionsConfig();
  const rolesCfg = getPlatformRolesConfig();
  const allowedRoleKeys = new Set((rolesCfg.roles || []).map((r) => r.key));
  const allowedPerms = new Set(Object.values(PERMISSIONS));
  const src = input && typeof input === 'object' ? input : {};
  const rawRoles = src.roles && typeof src.roles === 'object' ? src.roles : {};
  const out = {};
  for (const roleKey of allowedRoleKeys) {
    const raw = Array.isArray(rawRoles[roleKey]) ? rawRoles[roleKey] : defaults.roles[roleKey] || [];
    out[roleKey] = [...new Set(raw.map(String).filter((p) => allowedPerms.has(p)))];
  }
  return { roles: out };
}

export function getTenantRolePermissionsConfig(tenantId) {
  return getConfigValue(
    tenantId,
    'tenant_role_permissions_config',
    defaultTenantRolePermissionsConfig(),
    (parsed) => normalizeTenantRolePermissionsConfig(parsed, tenantId)
  );
}

export function permissionsForTenantRole(tenantId, roleKey) {
  const permsCfg = getTenantRolePermissionsConfig(tenantId);
  const list = permsCfg.roles?.[roleKey];
  if (Array.isArray(list)) return list;
  // Backward compatibility for base roles even if role list changed.
  if (Object.values(TENANT_ROLES).includes(roleKey)) return ROLE_PERMISSIONS[roleKey] || [];
  return [];
}

export function defaultSummaryCardsConfig() {
  return {
    cards: [
      { id: 'records-count', aggregation: 'count', label: 'Visible Records', description: 'After filters' },
      { id: 'records-value', aggregation: 'sum', field: 'value', label: 'Total Value', description: 'Sum of record values' },
      { id: 'records-completed', aggregation: 'count', filter: { mode: 'preset', preset: 'completed' }, label: 'Completed', description: 'Done records' },
      { id: 'records-overdue', aggregation: 'count', filter: { mode: 'preset', preset: 'overdue' }, label: 'Overdue', description: 'Needs attention' },
    ],
  };
}

export function normalizeSummaryCardsConfig(input) {
  const defaults = defaultSummaryCardsConfig();
  const src = input && typeof input === 'object' ? input : {};
  const raw = Array.isArray(src.cards) ? src.cards : [];
  const allowedAggs = new Set(['count', 'sum', 'avg', 'min', 'max']);
  const allowedPresets = new Set(['all', 'completed', 'overdue']);
  const allowedOps = new Set(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'is_empty', 'is_not_empty']);
  const normalizeFilter = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'string') {
      return allowedPresets.has(value) ? { mode: 'preset', preset: value } : fallback;
    }
    if (!value || typeof value !== 'object') return fallback;
    if (String(value.mode) === 'field') {
      const field = String(value.field || '').trim();
      const op = String(value.op || 'eq');
      const v = value.value !== undefined ? String(value.value) : undefined;
      if (!field) return fallback;
      if (!allowedOps.has(op)) return fallback;
      return { mode: 'field', field, op, value: v };
    }
    const preset = String(value.preset || value.filter || '').trim();
    return allowedPresets.has(preset) ? { mode: 'preset', preset } : fallback;
  };
  const cards = raw
    .filter((c) => c && typeof c === 'object')
    .map((c, idx) => ({
      id: String(c.id || `card-${idx}`),
      aggregation: allowedAggs.has(String(c.aggregation))
        ? String(c.aggregation)
        : String(c.type) === 'metric_sum'
          ? 'sum'
          : String(c.type) === 'metric_avg'
            ? 'avg'
            : String(c.metric) === 'sumValue'
              ? 'sum'
              : 'count',
      field: c.field !== undefined ? String(c.field) : defaults.cards[idx]?.field,
      filter: normalizeFilter(c.filter, defaults.cards[idx]?.filter),
      label:
        String(c.label || defaults.cards[idx]?.label || '').trim().slice(0, 60) ||
        defaults.cards[idx]?.label,
      description:
        String(c.description || defaults.cards[idx]?.description || '').trim().slice(0, 120) ||
        defaults.cards[idx]?.description,
    }));
  return { cards: cards.slice(0, 20).length ? cards.slice(0, 20) : defaults.cards };
}

export function normalizePageAccessConfigForTenant(input, tenantId) {
  const defaults = defaultPageAccessConfig();
  const rolesCfg = getPlatformRolesConfig();
  const roleKeys = [...new Set((rolesCfg.roles || []).map((r) => r.key))];

  const src = input && typeof input === 'object' ? input : {};
  const validPages = new Set(defaults.pages);
  const normalizeList = (raw) =>
    (Array.isArray(raw) ? raw : [])
      .map(String)
      .filter((p) => validPages.has(p));
  const roles = src.roles && typeof src.roles === 'object' ? src.roles : {};
  // `pages` represents the set of pages that existed when the config was saved.
  // When we add new pages in a future release, we auto-include them using role defaults.
  // But we must NOT re-add pages that an admin intentionally unchecked.
  const knownPages = normalizeList(src.pages);
  const newPages = defaults.pages.filter((p) => !knownPages.includes(p));
  const normalizePerm = (value, fallback) => ({
    read: value && typeof value === 'object' ? Boolean(value.read) : Boolean(fallback?.read),
    write: value && typeof value === 'object' ? Boolean(value.write) : Boolean(fallback?.write),
  });
  const mergeRolePages = (roleKey) => {
    const legacySavedPages = normalizeList(roles[roleKey]);
    const isLegacy = Array.isArray(roles[roleKey]);
    const saved = !isLegacy && roles[roleKey] && typeof roles[roleKey] === 'object' ? roles[roleKey] : null;
    const baseFallback =
      defaults.roles[roleKey] ||
      defaults.roles.VIEWER ||
      Object.values(defaults.roles)[0];
    const base = saved || (legacySavedPages.length ? null : baseFallback);
    const out = {};
    for (const page of defaults.pages) {
      const legacyRead = legacySavedPages.includes(page);
      const fallback = baseFallback?.[page] || { read: false, write: false };
      const fromSaved = saved ? saved[page] : null;
      const next = fromSaved
        ? normalizePerm(fromSaved, fallback)
        : legacyRead
          ? { read: true, write: fallback.write }
          : normalizePerm(base?.[page], fallback);
      out[page] = next;
    }
    // Auto-add any new pages based on defaults read/write (only if the page is new).
    for (const page of newPages) {
      out[page] = out[page] || baseFallback?.[page] || { read: false, write: false };
    }
    return out;
  };

  const outRoles = {};
  for (const roleKey of roleKeys) {
    outRoles[roleKey] = mergeRolePages(roleKey);
  }
  return {
    pages: defaults.pages,
    roles: outRoles,
  };
}

export function normalizePageAccessConfig(input) {
  // Backward-compatible default when tenantId isn't available.
  return normalizePageAccessConfigForTenant(input, null);
}

export function defaultThemeConfig() {
  return {
    primaryColor: '#2563eb',
    accentColor: '#eaf1ff',
    backgroundColor: '#f7f9fc',
    cardColor: '#ffffff',
    sidebarColor: '#ffffff',
    radius: '0.875rem',
  };
}

export function normalizeHexColor(value, fallback) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return fallback;
}

export function normalizeRadius(value, fallback) {
  const raw = String(value || '').trim();
  if (/^(0|0?\.\d+|[1-9]\d*(\.\d+)?)(rem|px)$/.test(raw)) return raw;
  return fallback;
}

export function normalizeThemeConfig(input) {
  const defaults = defaultThemeConfig();
  const src = input && typeof input === 'object' ? input : {};
  return {
    primaryColor: normalizeHexColor(src.primaryColor, defaults.primaryColor),
    accentColor: normalizeHexColor(src.accentColor, defaults.accentColor),
    backgroundColor: normalizeHexColor(src.backgroundColor, defaults.backgroundColor),
    cardColor: normalizeHexColor(src.cardColor, defaults.cardColor),
    sidebarColor: normalizeHexColor(src.sidebarColor, defaults.sidebarColor),
    radius: normalizeRadius(src.radius, defaults.radius),
  };
}

export function normalizeDashboardConfig(input, tenantId = DEFAULT_TENANT_ID) {
  const defaults = defaultDashboardConfig();
  const src = input && typeof input === 'object' ? input : {};
  const validFields = new Set([
    'status',
    'dealStage',
    'winOrLoss',
    'prospectType',
    'engagementType',
    'value',
    'dueDate',
    'owner',
    'currency',
    ...getTenantFieldDefinitions(tenantId).map((field) => `custom:${field.key}`),
  ]);
  const rawWidgets = Array.isArray(src.widgets)
    ? src.widgets
    : src.sections && typeof src.sections === 'object'
      ? defaults.widgets
      : defaults.widgets;
  const allowedTypes = new Set(['metric_count', 'metric_sum', 'metric_avg', 'bar', 'pie']);
  const widgets = rawWidgets
    .map((w, i) => {
      const widget = w && typeof w === 'object' ? w : {};
      const type = allowedTypes.has(String(widget.type))
        ? String(widget.type)
        : 'metric_count';
      const id = String(widget.id || `widget-${i + 1}`)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .slice(0, 64);
      const requestedField = widget.field ? String(widget.field).trim() : '';
      const field = validFields.has(requestedField) ? requestedField : '';
      return {
        id: id || `widget-${i + 1}`,
        title: String(widget.title || 'Dashboard Widget').slice(0, 80),
        type,
        field: type === 'metric_count' ? '' : field,
        limit: Math.max(1, Math.min(20, Number(widget.limit || 8))),
      };
    })
    .filter((w) => w.type === 'metric_count' || w.field);
  return {
    title: String(src.title || defaults.title).slice(0, 80),
    subtitle: String(src.subtitle || defaults.subtitle).slice(0, 180),
    widgets: widgets.length ? widgets : defaults.widgets,
  };
}

export function normalizeListTableLayout(input) {
  // Defined inside the function to avoid top-level initialization ordering issues
  // (this runs during startup seeding before the rest of the module is evaluated).
  const LIST_TABLE_COLUMN_KEYS = [
    'prospect',
    'description',
    'owner',
    'dueDate',
    'stage',
    'status',
    'value',
    'winLoss',
  ];
  const defaults = { columns: [...LIST_TABLE_COLUMN_KEYS] };
  const src = input && typeof input === 'object' ? input : {};
  const raw = Array.isArray(src.columns) ? src.columns : null;
  if (!raw) return defaults;
  const columns = raw.map(String).filter((key) => LIST_TABLE_COLUMN_KEYS.includes(key));
  return { columns: columns.length ? columns : defaults.columns };
}

export function normalizeReportsLayout(input) {
  // Defined inside the function to avoid top-level initialization ordering issues.
  const REPORT_SECTION_KEYS = [
    'pipelineByStatus',
    'countByOwner',
    'dueDateTimeline',
    'winLoss',
    'engagementType',
  ];
  const defaults = { sections: [...REPORT_SECTION_KEYS] };
  const src = input && typeof input === 'object' ? input : {};
  const raw = Array.isArray(src.sections) ? src.sections : null;
  if (!raw) return defaults;
  const sections = raw.map(String).filter((key) => REPORT_SECTION_KEYS.includes(key));
  return { sections: sections.length ? sections : defaults.sections };
}

export function normalizeCaseStudyLayoutValue(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.columns)) {
    return null;
  }
  const columns = input.columns
    .filter((col) => col && typeof col === 'object')
    .map((col, index) => {
      const normalized = {
        id: String(col.id || `col-${index + 1}`).trim(),
        entries: Array.isArray(col.entries)
          ? col.entries.filter((entry) => entry && typeof entry === 'object')
          : [],
      };
      if (col.title !== undefined && col.title !== null && String(col.title).trim()) {
        normalized.title = String(col.title);
      }
      return normalized;
    })
    .filter((col) => col.entries.length > 0);
  return { columns };
}

export function resolveDashboardConfig(tenantId, user) {
  const normalize = (parsed) => normalizeDashboardConfig(parsed, tenantId);
  const fallback = getConfigValue(
    tenantId,
    'dashboard_config',
    defaultDashboardConfig(),
    normalize
  );
  if (!user) return fallback;
  const userId = user.sub || user.id;
  if (userId) {
    const userDash = getConfigValue(tenantId, `user_dashboard:${userId}`, null);
    if (userDash && typeof userDash === 'object') return normalize(userDash);
  }
  const roleKey = user.tenantRole || user.role;
  if (roleKey) {
    const roleDash = getConfigValue(tenantId, `role_dashboard:${roleKey}`, null);
    if (roleDash && typeof roleDash === 'object') return normalize(roleDash);
  }
  return fallback;
}

export function getSettingsPayload(tenantId = DEFAULT_TENANT_ID, user = null) {
  ensureStandardLookupCategories(tenantId);
  const defaultNotif = {
    dueSoonThreshold: '3',
    emailEnabled: false,
  };
  const caseStudyEnabled = getConfigValue(
    tenantId,
    'case_study_enabled',
    true,
    (parsed) => {
      if (typeof parsed === 'boolean') return parsed;
      const s = String(parsed ?? '').trim().toLowerCase();
      if (!s) return true;
      return ['1', 'true', 'yes', 'on'].includes(s);
    }
  );
  const notifications = getConfigValue(
    tenantId,
    'notification_settings',
    { ...defaultNotif },
    (parsed) => ({
      dueSoonThreshold: String(parsed.dueSoonThreshold ?? defaultNotif.dueSoonThreshold),
      emailEnabled: false,
    })
  );
  let reminderOffsets = getConfigValue(tenantId, 'reminder_offsets', null);
  if (!Array.isArray(reminderOffsets) || !reminderOffsets.length) {
    reminderOffsets = inferReminderOffsets(String(notifications.dueSoonThreshold));
  }
  const dashboard = resolveDashboardConfig(tenantId, user);
  const listTableLayout = getConfigValue(
    tenantId,
    'list_table_layout',
    normalizeListTableLayout(null),
    normalizeListTableLayout
  );
  const reportsLayout = getConfigValue(
    tenantId,
    'reports_layout',
    normalizeReportsLayout(null),
    normalizeReportsLayout
  );
  const caseStudyLayout = getConfigValue(
    tenantId,
    'case_study_layout',
    null,
    normalizeCaseStudyLayoutValue
  );
  const terminology = getConfigValue(
    tenantId,
    'terminology_config',
    defaultTerminologyConfig(),
    normalizeTerminologyConfig
  );
  const theme = getConfigValue(
    tenantId,
    'theme_config',
    defaultThemeConfig(),
    normalizeThemeConfig
  );
  const displayTimezone = getConfigValue(
    tenantId,
    'display_timezone',
    'UTC',
    (parsed) => String(parsed || 'UTC')
  );
  const pageAccess = getConfigValue(
    tenantId,
    'page_access_config',
    defaultPageAccessConfig(),
    (parsed) => normalizePageAccessConfigForTenant(parsed, tenantId)
  );
  const tenantRolePermissions = getConfigValue(
    tenantId,
    'tenant_role_permissions_config',
    defaultTenantRolePermissionsConfig(),
    (parsed) => normalizeTenantRolePermissionsConfig(parsed, tenantId)
  );
  const summaryCards = getConfigValue(
    tenantId,
    'summary_cards_config',
    defaultSummaryCardsConfig(),
    normalizeSummaryCardsConfig
  );
  return {
    tenantId,
    caseStudyEnabled,
    caseStudyLayout,
    notifications,
    reminderOffsets,
    dashboard,
    listTableLayout,
    reportsLayout,
    terminology,
    theme,
    displayTimezone,
    pageAccess,
    platformRoles: getPlatformRolesConfig(),
    tenantRolePermissions,
    summaryCards,
  };
}

export {
  getConfigValue,
  setConfigValue,
  ensureConfigValue,
  getGlobalConfigValue,
  setGlobalConfigValue,
};

