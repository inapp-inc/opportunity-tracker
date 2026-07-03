import jwt from 'jsonwebtoken';

export function createAuthMiddleware({ JWT_SECRET, buildAuthContext, isApiPath }) {
  return function authMiddleware(req, res, next) {
    if (req.path === '/auth/login') return next();
    if (req.path === '/health') return next();
    if (req.path.startsWith('/auth/invite/')) return next();
    if (req.path === '/auth/accept-invite') return next();
    if (req.method === 'GET' && !isApiPath(req.path)) return next();
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
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

