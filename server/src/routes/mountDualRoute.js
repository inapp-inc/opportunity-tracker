export function mountDualRoute(router, method, paths, ...handlers) {
  for (const p of paths) {
    router[method](p, ...handlers);
  }
}

