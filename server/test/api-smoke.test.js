import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, '..');

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // keep polling until the server binds the port
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server did not become healthy');
}

async function request(baseUrl, pathName, token, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${baseUrl}${pathName}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return { res, body };
}

test('RBAC API smoke: platform admin, records alias, viewer denial', { skip: !process.env.DATABASE_URL }, async () => {
  const port = 4300 + Math.floor(Math.random() * 400);
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = path.join(serverRoot, `.tmp-test-${process.pid}-${port}`);
  fs.rmSync(dataDir, { recursive: true, force: true });

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL,
      PORT: String(port),
      JWT_SECRET: 'test-secret',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForHealth(baseUrl);
    const login = await request(baseUrl, '/auth/login', '', {
      method: 'POST',
      body: JSON.stringify({
        email: 'demo@example.com',
        password: 'password',
        remember: false,
      }),
    });
    assert.equal(login.res.status, 200);
    const token = login.body.accessToken;

    const me = await request(baseUrl, '/auth/me', token);
    assert.equal(me.body.platformRole, 'PLATFORM_ADMIN');
    assert.equal(me.body.memberships.length, 0);

    const records = await request(baseUrl, '/records?archived=exclude', token);
    const opportunities = await request(baseUrl, '/opportunities?archived=exclude', token);
    assert.equal(records.res.status, 200);
    assert.equal(opportunities.res.status, 200);
    assert.equal(records.body.items.length, opportunities.body.items.length);

    const catalog = await request(baseUrl, '/catalog/lookups', token);
    assert.equal(catalog.res.status, 200, 'GET /catalog/lookups must be authenticated like other API routes');
    assert.ok(Array.isArray(catalog.body.dealStages) || catalog.body.dealStages === undefined);

    const template = await fetch(`${baseUrl}/records/template.csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(template.status, 200);
    assert.match(await template.text(), /owner_emails/);

    const managerEmail = `manager-${port}@example.com`;
    const manager = await request(baseUrl, '/platform/users', token, {
      method: 'POST',
      body: JSON.stringify({
        email: managerEmail,
        password: 'password',
        name: 'Manager',
        role: 'EDITOR',
        tenantIds: [me.body.activeTenantId],
      }),
    });
    assert.equal(manager.res.status, 201);
    const managerLogin = await request(baseUrl, '/auth/login', '', {
      method: 'POST',
      body: JSON.stringify({
        email: managerEmail,
        password: 'password',
        remember: false,
      }),
    });
    const managerToken = managerLogin.body.accessToken;

    const imported = await request(baseUrl, '/records/import', managerToken, {
      method: 'POST',
      body: JSON.stringify({
        rows: [
          {
            prospect: 'Imported Record',
            opportunity_description: 'CSV import smoke test',
            owner_emails: managerEmail,
            due_date: '2026-06-01',
            status: 'In Progress',
            prospect_type: 'Enterprise',
            engagement_type: 'Demo',
            deal_stage: 'Discovery',
            value: '1234',
            currency: 'USD',
            win_or_loss: 'Open',
          },
        ],
      }),
    });
    assert.equal(imported.res.status, 201);
    assert.equal(imported.body.created, 1);
    assert.equal(imported.body.errors.length, 0);

    const viewerEmail = `viewer-${port}@example.com`;
    const created = await request(baseUrl, '/platform/users', token, {
      method: 'POST',
      body: JSON.stringify({
        email: viewerEmail,
        password: 'password',
        name: 'Viewer',
        role: 'VIEWER',
        tenantIds: [me.body.activeTenantId],
      }),
    });
    assert.equal(created.res.status, 201);

    const viewerLogin = await request(baseUrl, '/auth/login', '', {
      method: 'POST',
      body: JSON.stringify({
        email: viewerEmail,
        password: 'password',
        remember: false,
      }),
    });
    const viewerToken = viewerLogin.body.accessToken;
    const denied = await request(baseUrl, '/records', viewerToken, {
      method: 'POST',
      body: JSON.stringify({ prospect: 'Denied', dueDate: '2026-06-01', status: 'Open' }),
    });
    assert.equal(denied.res.status, 403);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
