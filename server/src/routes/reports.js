import express from 'express';
import { PERMISSIONS } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';

export function createReportsRouter({ analyticsApi }) {
  const router = express.Router();
router.get('/reports/pipeline-summary', requireTenantPermission(PERMISSIONS.REPORTS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  res.json(analyticsApi.buildPipelineSummary(tenantId, req.query));
});
  return router;
}

