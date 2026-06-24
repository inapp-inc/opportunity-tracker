import express from 'express';
import { PERMISSIONS } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';

export function createAnalyticsRouter({ analyticsApi }) {
  const router = express.Router();
router.get('/analytics/dimensions', requireTenantPermission(PERMISSIONS.REPORTS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  res.json({
    dimensions: analyticsApi.analyticsDimensionsForTenant(tenantId),
    measures: [
      { key: 'count', label: 'Record count' },
      { key: 'sumValue', label: 'Sum of value' },
      { key: 'avgValue', label: 'Average value' },
    ],
  });
});

router.post('/analytics/query', requireTenantPermission(PERMISSIONS.REPORTS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  try {
    res.json(analyticsApi.runAnalyticsQuery(tenantId, req.body || {}));
  } catch (e) {
    res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid analytics query' });
  }
});
  return router;
}

