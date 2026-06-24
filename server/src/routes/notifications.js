import express from 'express';
import { db } from '../db.js';
import { PERMISSIONS } from '../rbac.js';
import { requireTenantPermission } from '../middleware/permissions.js';
import { tenantIdFromReq } from '../utils/tenant.js';
import { mapNotificationRow } from '../services/notificationService.js';

export function createNotificationsRouter() {
  const router = express.Router();
router.get('/notifications', requireTenantPermission(PERMISSIONS.NOTIFICATIONS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const rows = db
    .prepare(
      `SELECT n.*, o.prospect AS prospect
       FROM notifications n
       JOIN opportunities o ON o.id = n.opportunity_id AND o.tenant_id = n.tenant_id
       WHERE n.tenant_id = ?
       ORDER BY n.created_at DESC`
    )
    .all(tenantId);
  res.json({
    items: rows.map(mapNotificationRow),
  });
});

router.patch('/notifications/:id/read', requireTenantPermission(PERMISSIONS.NOTIFICATIONS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const r = db
    .prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND tenant_id = ?')
    .run(req.params.id, tenantId);
  if (r.changes === 0) return res.status(404).json({ message: 'Not found' });
  res.json({ ok: true });
});

router.patch('/notifications/read-all', requireTenantPermission(PERMISSIONS.NOTIFICATIONS_READ), (req, res) => {
  const tenantId = tenantIdFromReq(req);
  db.prepare('UPDATE notifications SET is_read = 1 WHERE tenant_id = ?').run(tenantId);
  res.json({ ok: true });
});
  return router;
}

