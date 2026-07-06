import express from 'express';
import { db } from '../db.js';
import { PERMISSIONS } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import { mapOpportunityRows } from '../services/opportunityService.js';

export function createProspectGroupsRouter() {
  const router = express.Router();
router.get('/prospect-groups', requireTenantPermission(PERMISSIONS.RECORDS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const q = String(req.query?.q || '').trim();
  const params = [tenantId];
  let sql = `SELECT
    prospect AS name,
    (SELECT opportunity_description
     FROM opportunities o2
     WHERE o2.prospect = o.prospect AND o2.tenant_id = o.tenant_id
       AND COALESCE(o2.archived, 0) = 0 AND COALESCE(o2.is_draft, 0) = 0
     ORDER BY o2.created_at ASC LIMIT 1) AS description,
    COUNT(*) AS deliverable_count,
    COALESCE(SUM(value), 0) AS total_value,
    MIN(currency) AS currency,
    (SELECT deal_stage
     FROM opportunities o3
     WHERE o3.prospect = o.prospect AND o3.tenant_id = o.tenant_id
       AND COALESCE(o3.archived, 0) = 0 AND COALESCE(o3.is_draft, 0) = 0
     ORDER BY o3.updated_at DESC LIMIT 1) AS deal_stage,
    CASE
      WHEN SUM(CASE WHEN win_or_loss = 'Win' THEN 1 ELSE 0 END) > 0 THEN 'Win'
      WHEN COUNT(*) = SUM(CASE WHEN win_or_loss = 'Loss' THEN 1 ELSE 0 END) THEN 'Loss'
      ELSE 'Open'
    END AS win_or_loss,
    MAX(updated_at) AS last_updated
  FROM opportunities o
  WHERE tenant_id = ?
    AND COALESCE(archived, 0) = 0
    AND COALESCE(is_draft, 0) = 0`;
  if (q) {
    sql += ` AND lower(prospect) LIKE ?`;
    params.push(`%${q.toLowerCase()}%`);
  }
  sql += ` GROUP BY prospect, tenant_id ORDER BY MAX(updated_at) DESC`;
  const rows = db.prepare(sql).all(...params);
  res.json({
    items: rows.map((row) => ({
      name: row.name,
      description: row.description || '',
      deliverableCount: row.deliverable_count,
      totalValue: row.total_value,
      currency: row.currency || 'USD',
      dealStage: row.deal_stage || 'Discovery',
      winOrLoss: row.win_or_loss || 'Open',
      lastUpdated: row.last_updated,
    })),
  });
});

router.get(
  '/prospect-groups/records',
  requireTenantPermission(PERMISSIONS.RECORDS_READ),
  (req, res) => {
    const tenantId = tenantIdFromReq(req);
    const prospect = String(req.query?.prospect || '').trim();
    if (!prospect) return res.status(400).json({ message: 'prospect query param required' });
    const rows = db
      .prepare(
        `SELECT * FROM opportunities
         WHERE tenant_id = ?
           AND prospect = ?
           AND COALESCE(archived, 0) = 0
           AND COALESCE(is_draft, 0) = 0
         ORDER BY updated_at DESC`
      )
      .all(tenantId, prospect);
    res.json({ items: mapOpportunityRows(rows, tenantId) });
  }
);
  return router;
}

