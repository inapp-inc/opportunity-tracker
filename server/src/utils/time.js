export function nowIso() {
  return new Date().toISOString();
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

export function dayDiff(a, b) {
  const ms = 86400000;
  return Math.round((startOfDay(a) - startOfDay(b)) / ms);
}
