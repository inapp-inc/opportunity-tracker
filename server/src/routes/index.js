import express from 'express';
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

