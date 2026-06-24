import express from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { requirePlatformAdmin } from '../middleware/permissions.js';
import { nowIso } from '../utils/time.js';
import { slugify } from '../utils/slug.js';
import { seedTenantDefaults } from '../startup/seeds.js';

export function createTenantsRouter() {
  const router = express.Router();

router.get('/tenants', requirePlatformAdmin, (_req, res) => {
  const rows = db
    .prepare(`SELECT id, name, slug, status, created_at, updated_at FROM tenants ORDER BY name`)
    .all();
  res.json({
    items: rows.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    })),
  });
});

router.post('/tenants', requirePlatformAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const slug = slugify(String(req.body?.slug || name));
  if (!name) return res.status(400).json({ message: 'name required' });
  if (!slug) return res.status(400).json({ message: 'slug required' });
  const exists = db.prepare(`SELECT id FROM tenants WHERE slug = ?`).get(slug);
  if (exists) return res.status(409).json({ message: 'Tenant slug already exists' });
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
     VALUES (?, ?, ?, 'ACTIVE', ?, ?)`
  ).run(id, name, slug, now, now);
  seedTenantDefaults(id);
  const row = db
    .prepare(`SELECT id, name, slug, status, created_at, updated_at FROM tenants WHERE id = ?`)
    .get(id);
  res.status(201).json({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

router.patch('/tenants/:id', requirePlatformAdmin, (req, res) => {
  const id = req.params.id;
  const row = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ message: 'Not found' });
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : row.name;
  const status =
    req.body?.status !== undefined ? String(req.body.status).trim() : row.status;
  if (!name) return res.status(400).json({ message: 'name required' });
  if (!['ACTIVE', 'INACTIVE'].includes(status)) {
    return res.status(400).json({ message: 'invalid status' });
  }
  const now = nowIso();
  db.prepare(
    `UPDATE tenants SET name = ?, status = ?, updated_at = ? WHERE id = ?`
  ).run(name, status, now, id);
  const saved = db
    .prepare(`SELECT id, name, slug, status, created_at, updated_at FROM tenants WHERE id = ?`)
    .get(id);
  res.json({
    id: saved.id,
    name: saved.name,
    slug: saved.slug,
    status: saved.status,
    createdAt: saved.created_at,
    updatedAt: saved.updated_at,
  });
});

  return router;
}

