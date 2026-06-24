export function createBasePathMiddleware(APP_BASE_PATH) {
  return (req, _res, next) => {
    if (!APP_BASE_PATH) return next();
    if (req.url === APP_BASE_PATH) {
      req.url = '/';
    } else if (req.url.startsWith(`${APP_BASE_PATH}/`)) {
      req.url = req.url.slice(APP_BASE_PATH.length) || '/';
    }
    next();
  };
}

