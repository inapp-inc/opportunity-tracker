import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const legacy = fs.readFileSync(path.join(root, 'index.legacy.js'), 'utf8');
const L = legacy.split('\n');

function rng(a, b) {
  return L.slice(a - 1, b).join('\n');
}

function exp(body, names) {
  let out = body;
  for (const n of names) {
    out = out.replace(new RegExp(`^function ${n}\\b`, 'm'), `export function ${n}`);
    out = out.replace(new RegExp(`^async function ${n}\\b`, 'm'), `export async function ${n}`);
  }
  return out;
}

function expConst(body, name) {
  return body.replace(new RegExp(`^const ${name}\\b`, 'm'), `export const ${name}`);
}

function w(file, content) {
  const p = path.join(root, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content.trimStart() + '\n');
  console.log('OK', file);
}

// --- middleware ---
w('middleware/permissions.js', `import { PERMISSIONS, PLATFORM_ROLES } from '../rbac.js';

${exp(rng(69, 110), ['requirePlatformAdmin', 'requireTenantPermission', 'requireRoles'])}
`);

w('middleware/auth.js', `import jwt from 'jsonwebtoken';

export function createAuthMiddleware({ JWT_SECRET, buildAuthContext, isApiPath }) {
  return function authMiddleware(req, res, next) {
    if (req.path === '/auth/login') return next();
    if (req.path === '/health') return next();
    if (req.method === 'GET' && !isApiPath(req.path)) return next();
    const h = req.headers.authorization || '';
    const m = /^Bearer\\s+(.+)$/i.exec(h);
    if (!m) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const tokenUser = jwt.verify(m[1], JWT_SECRET);
      const context = buildAuthContext(String(tokenUser?.sub || ''), req);
      if (!context) return res.status(403).json({ message: 'Forbidden' });
      req.user = context;
      next();
    } catch {
      return res.status(401).json({ message: 'Unauthorized' });
    }
  };
}
`);

w('middleware/basePath.js', `export function createBasePathMiddleware(APP_BASE_PATH) {
  return (req, _res, next) => {
    if (!APP_BASE_PATH) return next();
    if (req.url === APP_BASE_PATH) {
      req.url = '/';
    } else if (req.url.startsWith(\`\${APP_BASE_PATH}/\`)) {
      req.url = req.url.slice(APP_BASE_PATH.length) || '/';
    }
    next();
  };
}
`);

w('middleware/recordsAlias.js', `export function recordsAliasMiddleware(req, _res, next) {
  if (req.path === '/records' || req.path.startsWith('/records/')) {
    req.url = req.url
      .replace(/^\\/records\\b/, '/opportunities')
      .replace(/\\/artifacts(?=\\/|$)/, '/artifact-links');
  }
  next();
}
`);

// --- configStorage ---
w('services/configStorage.js', `import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';

function tenantConfigKey(tenantId, key) {
  return \`tenant:\${tenantId || DEFAULT_TENANT_ID}:\${key}\`;
}

function globalConfigKey(key) {
  return \`global:\${key}\`;
}

${exp(rng(2234, 2262), ['getGlobalConfigValue', 'setGlobalConfigValue'])}

${exp(rng(3538, 3578), ['getConfigValue', 'setConfigValue', 'ensureConfigValue'])}
`);

// --- configService ---
const configFuncs = [
  'inferReminderOffsets', 'defaultDashboardConfig', 'defaultTerminologyConfig',
  'normalizeTerminologyConfig', 'defaultPageAccessConfig', 'defaultPlatformRolesConfig',
  'normalizePlatformRolesConfig', 'getPlatformRolesConfig', 'isAllowedPlatformRole',
  'tenantRoleKeyFromLegacyRole', 'defaultTenantRolePermissionsConfig',
  'normalizeTenantRolePermissionsConfig', 'getTenantRolePermissionsConfig',
  'permissionsForTenantRole', 'defaultSummaryCardsConfig', 'normalizeSummaryCardsConfig',
  'normalizePageAccessConfigForTenant', 'normalizePageAccessConfig', 'defaultThemeConfig',
  'normalizeHexColor', 'normalizeRadius', 'normalizeThemeConfig', 'normalizeDashboardConfig',
  'normalizeListTableLayout', 'normalizeReportsLayout', 'normalizeCaseStudyLayoutValue',
  'resolveDashboardConfig', 'getSettingsPayload',
];
w('services/configService.js', `import { db } from '../db.js';
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

${exp(rng(3012, 3704), configFuncs)}

export {
  getConfigValue,
  setConfigValue,
  ensureConfigValue,
  getGlobalConfigValue,
  setGlobalConfigValue,
};
`);

// --- lookupService ---
w('services/lookupService.js', `import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { getConfigValue, setConfigValue } from './configStorage.js';

export const PROTECTED_LOOKUP_CATEGORIES = new Set([
  'DEAL_STAGE',
  'DELIVERABLES',
  'ENGAGEMENT_TYPE',
  'PROSPECT_TYPE',
  'WIN_LOSS',
  'ARTIFACT_TYPE',
  'CURRENCY',
]);

${exp(rng(2264, 2279), ['getDealStageValues'])}

${exp(rng(3706, 3890), [
  'lookupCategoryKey', 'lookupCategoryLabel', 'defaultLookupCategories',
  'ensureLookupEntriesForTenant', 'ensureStandardLookupCategories',
  'getArtifactTypeEntries', 'artifactLabelToCode', 'artifactCodeToLabel',
  'resolveArtifactTypeInput', 'getLookupCategoryConfigs', 'getLookupsPayload',
])}
`);

// --- ownerService (breaks schema <-> opportunity cycle) ---
w('services/ownerService.js', `import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { nowIso } from '../utils/time.js';
import { isUuid } from '../utils/uuid.js';

${exp(rng(2281, 2290), ['getActiveUsersMap'])}

${exp(rng(2403, 2469), ['normalizeOwnerIds', 'syncRecordOwners', 'resolveOwnersFromJson', 'ownerDisplayNames'])}
`);

// --- schemaService ---
w('services/schemaService.js', `import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { slugify } from '../utils/slug.js';
import { nowIso } from '../utils/time.js';
import {
  assertChoiceValue,
  importColumnTypeForField,
  isSchemaChoiceFieldType,
  isSchemaMultiChoiceFieldType,
  schemaKeyToSnakeColumn,
  validateChoiceValue,
} from '../schemaChoices.js';
import { getConfigValue, setConfigValue } from './configStorage.js';
import { getDealStageValues, lookupCategoryKey } from './lookupService.js';
import { normalizeOwnerIds } from './ownerService.js';

${expConst(rng(2130, 2130), 'RECORD_IMPORT_FIELD_EXCLUDE')}

${exp(rng(2132, 2216), [
  'recordFieldDbColumn', 'activeSystemRecordFields', 'readRecordFieldFromSource',
  'validateRecordSchemaChoiceFields', 'validateRecordSchemaRequiredForPublish',
])}

${exp(rng(3892, 4243), [
  'allowedFieldTypes', 'fieldKeyFromLabel', 'normalizeFieldOptions', 'defaultSystemFieldDefinitions',
  'getRecordFormFieldConfig', 'setRecordFormFieldConfig', 'resolveLookupOptions',
  'recordSchemaFieldOptions', 'dealStageValuesForTenant', 'systemFieldLookupCategory',
  'isRecordSchemaFieldActive', 'getRecordSchemaDefinitions', 'updateSystemFieldDefinition',
  'parseFieldDefinitionInput', 'mapFieldDefinitionRow', 'getTenantFieldDefinitions',
  'getTenantFieldDefinition', 'normalizeCustomFields',
])}

function validateLookupValue(label, raw, options, multi = false) {
  return validateChoiceValue(label, raw, options, multi);
}

export function validateImportLookupValue(label, raw, options, multi = false) {
  assertChoiceValue(label, raw, options, multi);
}

export { validateLookupValue, RECORD_IMPORT_FIELD_EXCLUDE };
`);

w('services/opportunityService.js', `import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { nowIso } from '../utils/time.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import { getDealStageValues, artifactLabelToCode } from './lookupService.js';
import {
  getRecordSchemaDefinitions,
  normalizeCustomFields,
  validateRecordSchemaChoiceFields,
  validateRecordSchemaRequiredForPublish,
  isRecordSchemaFieldActive,
} from './schemaService.js';
import {
  getActiveUsersMap,
  normalizeOwnerIds,
  syncRecordOwners,
  resolveOwnersFromJson,
  ownerDisplayNames,
} from './ownerService.js';

${exp(rng(2125, 2128), ['defaultDealStage'])}

${exp(rng(2471, 2512), ['logActivity', 'mapActivityRow'])}

${exp(rng(2514, 2548), ['recordOpportunityFieldChanges'])}

${exp(rng(2550, 2552), ['normalizeOwners'])}

${exp(rng(2554, 2558), ['formatDeliverables'])}

${exp(rng(2560, 2680), [
  'mapOpportunityRow', 'mapOpportunityRows', 'validateOpportunityRowForPublish', 'createOpportunityRecord',
])}

${exp(rng(4262, 4272), ['mapArtifactRow'])}

${exp(rng(4296, 4328), ['validateOpportunityCreate', 'validateOpportunityPartial'])}
`);

w('services/importExportService.js', `import ExcelJS from 'exceljs';
import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { csvEscape, formatExportCell } from '../utils/csv.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import {
  activeSystemRecordFields,
  recordFieldDbColumn,
  recordSchemaFieldOptions,
  getRecordSchemaDefinitions,
  getTenantFieldDefinitions,
  RECORD_IMPORT_FIELD_EXCLUDE,
  validateImportLookupValue,
} from './schemaService.js';
import { importColumnTypeForField, isSchemaChoiceFieldType, isSchemaMultiChoiceFieldType } from '../schemaChoices.js';
import { defaultDealStage, mapOpportunityRow, createOpportunityRecord } from './opportunityService.js';

${exp(rng(2682, 2997), [
  'recordImportHeaders', 'recordImportColumns', 'buildRecordImportWorkbook',
  'formatImportDateValue', 'excelColumnLetter', 'importCellValue', 'rowsFromImportWorkbook',
  'validateImportRowLookups', 'splitImportList', 'importOwnerIds', 'parseImportCustomValue',
  'recordImportRowToPayload',
])}

export function exportRecordRows(req, analyticsApi) {
  const tenantId = tenantIdFromReq(req);
  let ownerId = req.query.ownerId ? String(req.query.ownerId) : '';
  if (req.query.mine === '1' || req.query.mine === 'true') {
    const sub = req.user?.sub ? String(req.user.sub) : '';
    if (sub) ownerId = sub;
  }
  const { where, params } = analyticsApi.buildRecordFilterWhere(tenantId, {
    archived: req.query.archived || 'exclude',
    draft: req.query.draft,
    status: req.query.status,
    dealStage: req.query.dealStage,
    winOrLoss: req.query.winOrLoss,
    prospectType: req.query.prospectType,
    engagementType: req.query.engagementType,
    dueDateFrom: req.query.fromDueDate,
    dueDateTo: req.query.toDueDate,
    ownerId,
    q: req.query.q,
    customField: req.query.customField,
    customValue: req.query.customValue,
  });
  const sql = \`SELECT * FROM opportunities \${where} ORDER BY due_date ASC\`;
  return db.prepare(sql).all(...params);
}

${exp(rng(1984, 2012), ['recordExportRows'])}

export { csvEscape, formatExportCell };
`);

w('services/notificationService.js', `import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { nowIso, startOfDay, dayDiff } from '../utils/time.js';
import { getSettingsPayload } from './configService.js';

${exp(rng(4245, 4260), ['getReminderOffsetsForEvaluator', 'reminderMessage'])}

${exp(rng(4274, 4294), ['mapNotificationRow'])}

${exp(rng(4460, 4533), ['runNotificationEvaluator'])}
`);

w('services/membershipService.js', `import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { DEFAULT_TENANT_ID } from '../constants.js';
import { nowIso } from '../utils/time.js';
import { isUuid } from '../utils/uuid.js';
import {
  PERMISSIONS,
  PLATFORM_ROLES,
  legacyRoleFromMembership,
  tenantRoleFromLegacyRole,
  TENANT_ROLES,
} from '../rbac.js';
import { requestedTenantId } from '../utils/tenant.js';
import {
  permissionsForTenantRole,
  getConfigValue,
  defaultPageAccessConfig,
  normalizePageAccessConfig,
  isAllowedPlatformRole,
} from './configService.js';

${exp(rng(63, 67), ['getTenant'])}

${exp(rng(179, 456), [
  'getMembershipRows', 'membershipToJson', 'userToJson', 'createOrUpdateMembership',
  'normalizeMembershipRole', 'validateMembershipInputs', 'normalizeMembershipStatus',
  'membershipErrorResponse', 'membershipInputsFromBody', 'syncUserTenantMemberships',
  'buildAuthContext',
])}
`);

w('startup/migrations.js', `import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { isUuid } from '../utils/uuid.js';
import { getRecordFormFieldConfig, setRecordFormFieldConfig } from '../services/schemaService.js';

${exp(rng(2292, 2401), ['migrateRetiredCaseStudySchemaFields', 'migrateLegacyOwnerIds'])}
`);

w('startup/seeds.js', `import { randomUUID } from 'crypto';
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

${exp(rng(4360, 4447), ['seedIfEmpty'])}

${exp(rng(4535, 4682), [
  'seedUsersIfEmpty', 'ensureDefaultPlatformAdminOnly', 'seedDealStagesIfEmpty',
  'seedLookupsIfEmpty', 'seedDefaultAppConfigIfEmpty', 'seedTenantDefaults',
])}
`);

console.log('Phase 2 done');
