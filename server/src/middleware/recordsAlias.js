export function recordsAliasMiddleware(req, _res, next) {
  if (req.path === '/records' || req.path.startsWith('/records/')) {
    req.url = req.url
      .replace(/^\/records\b/, '/opportunities')
      .replace(/\/artifacts(?=\/|$)/, '/artifact-links');
  }
  next();
}

