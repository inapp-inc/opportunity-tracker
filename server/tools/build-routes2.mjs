import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const L = fs.readFileSync(path.join(root, 'index.legacy.js'), 'utf8').split('\n');

function rng(a, b) {
  return L.slice(a - 1, b).join('\n').replace(/^app\./gm, 'router.');
}

function w(file, content) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content.trimStart() + '\n');
  console.log('OK', file);
}

const oppHeader = `import express from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { PERMISSIONS } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import { nowIso } from '../utils/time.js';
import { csvEscape } from '../utils/csv.js';
import {
  mapOpportunityRow,
  mapOpportunityRows,
  createOpportunityRecord,
  normalizeOwnerIds,
  syncRecordOwners,
  formatDeliverables,
  validateOpportunityPartial,
  validateOpportunityRowForPublish,
  recordOpportunityFieldChanges,
  logActivity,
  mapActivityRow,
  mapArtifactRow,
} from '../services/opportunityService.js';
import { normalizeCustomFields } from '../services/schemaService.js';
import { resolveArtifactTypeInput } from '../services/lookupService.js';
import {
  recordImportHeaders,
  buildRecordImportWorkbook,
  rowsFromImportWorkbook,
  recordImportRowToPayload,
} from '../services/importExportService.js';

export function createOpportunitiesRouter({ analyticsApi }) {
  const router = express.Router();
`;

w('routes/opportunities.js', `${oppHeader}
${rng(619, 1173)}
  return router;
}
`);

w('routes/prospectGroups.js', `import express from 'express';
import { db } from '../db.js';
import { PERMISSIONS } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import { mapOpportunityRows } from '../services/opportunityService.js';

export function createProspectGroupsRouter() {
  const router = express.Router();
${rng(671, 738)}
  return router;
}
`);

w('routes/notifications.js', `import express from 'express';
import { db } from '../db.js';
import { PERMISSIONS } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import { mapNotificationRow } from '../services/notificationService.js';

export function createNotificationsRouter() {
  const router = express.Router();
${rng(1175, 1204)}
  return router;
}
`);

w('routes/reports.js', `import express from 'express';
import { PERMISSIONS } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';

export function createReportsRouter({ analyticsApi }) {
  const router = express.Router();
${rng(1206, 1209)}
  return router;
}
`);

w('routes/analytics.js', `import express from 'express';
import { PERMISSIONS } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';

export function createAnalyticsRouter({ analyticsApi }) {
  const router = express.Router();
${rng(1211, 1230)}
  return router;
}
`);

w('routes/export.js', `import express from 'express';
import ExcelJS from 'exceljs';
import { PERMISSIONS } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import { csvEscape, exportRecordRows, recordExportRows } from '../services/importExportService.js';

export function createExportRouter({ analyticsApi }) {
  const router = express.Router();
${rng(2014, 2077).replace(/exportRecordRows\(req\)/g, 'exportRecordRows(req, analyticsApi)')}
  return router;
}
`);

const settingsHeader = `import express from 'express';
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
`;

w('routes/settings.js', `${settingsHeader}
${rng(1232, 1346)}
${rng(1348, 1372)}
${rng(1374, 1639)}
  return router;
}
`);

w('routes/index.js', `import express from 'express';
import { createAuthRouter } from './auth.js';
import { createTenantsRouter } from './tenants.js';
import { createUsersRouter } from './users.js';
import { createOpportunitiesRouter } from './opportunities.js';
import { createProspectGroupsRouter } from './prospectGroups.js';
import { createNotificationsRouter } from './notifications.js';
import { createReportsRouter } from './reports.js';
import { createAnalyticsRouter } from './analytics.js';
import { createExportRouter } from './export.js';
import { createSettingsRouter } from './settings.js';

/** Mount all API routes at root (each router registers full paths). */
export function createApiRouter(deps) {
  const router = express.Router();
  router.use(createAuthRouter());
  router.use(createTenantsRouter());
  router.use(createUsersRouter());
  router.use(createOpportunitiesRouter(deps));
  router.use(createProspectGroupsRouter());
  router.use(createNotificationsRouter());
  router.use(createReportsRouter(deps));
  router.use(createAnalyticsRouter(deps));
  router.use(createExportRouter(deps));
  router.use(createSettingsRouter());
  return router;
}
`);

console.log('routes phase 2 done');
