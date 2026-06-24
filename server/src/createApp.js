import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { verifyPassword } from './auth-utils.js';
import {
  PORT,
  JWT_SECRET,
  STATIC_AUTH_EMAIL,
  STATIC_AUTH_PASSWORD,
  STATIC_AUTH_ENABLED,
  CORS_ORIGINS,
  APP_BASE_PATH,
  DEFAULT_TENANT_ID,
} from './constants.js';
import { isApiPath } from './utils/isApiPath.js';
import { createBasePathMiddleware } from './middleware/basePath.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { recordsAliasMiddleware } from './middleware/recordsAlias.js';
import { buildAuthContext } from './services/membershipService.js';
import {
  mapOpportunityRow,
  ownerDisplayNames,
  defaultDealStage,
} from './services/opportunityService.js';
import { getTenantFieldDefinitions } from './services/schemaService.js';
import { initAnalytics } from './analytics.js';
import { createApiRouter } from './routes/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const analyticsApi = initAnalytics({
    db,
    mapOpportunityRow,
    ownerDisplayNames,
    getTenantFieldDefinitions,
    getDefaultDealStage: defaultDealStage,
    DEFAULT_TENANT_ID,
  });

  const app = express();
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        // If no allowlist is configured, permit all origins
        if (!CORS_ORIGINS.length) return callback(null, true);
        if (CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error('CORS origin not allowed'));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(createBasePathMiddleware(APP_BASE_PATH));

  app.get('/health', (_req, res) => {
    res.status(200).type('text/plain').send('ok');
  });

  app.post('/auth/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const remember = Boolean(req.body?.remember);
    const row = db
      .prepare(
        `SELECT id, email, password_hash, role, platform_role, status, tenant_id FROM users WHERE lower(email) = ?`
      )
      .get(email);
    let authed = null;
    if (row && row.status === 'ACTIVE' && verifyPassword(password, row.password_hash)) {
      authed = row;
    }
    if (
      !authed &&
      STATIC_AUTH_ENABLED &&
      email === STATIC_AUTH_EMAIL.toLowerCase() &&
      password === STATIC_AUTH_PASSWORD
    ) {
      const fallback = db
        .prepare(`SELECT id, email, role, platform_role, status, tenant_id FROM users WHERE lower(email) = ?`)
        .get(email);
      if (fallback && fallback.status === 'ACTIVE') authed = fallback;
    }
    if (!authed) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const accessToken = jwt.sign(
      {
        sub: authed.id,
        email: authed.email,
        tenantId: authed.tenant_id || DEFAULT_TENANT_ID,
      },
      JWT_SECRET,
      { expiresIn: remember ? '30d' : '12h' }
    );
    res.json({ accessToken, expiresIn: remember ? '30d' : '12h' });
  });

  const authMiddleware = createAuthMiddleware({
    JWT_SECRET,
    buildAuthContext,
    isApiPath,
  });
  app.use(authMiddleware);
  app.use(recordsAliasMiddleware);

  app.use(createApiRouter({ analyticsApi }));

  const webDist = path.join(__dirname, '../../web/dist');
  const serveStatic =
    fs.existsSync(webDist) &&
    (process.env.NODE_ENV === 'production' || process.env.SERVE_STATIC === '1');
  if (serveStatic) {
    app.use(express.static(webDist));
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET') return next();
      if (isApiPath(req.path)) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  return { app, analyticsApi, port: PORT, serveStatic };
}
