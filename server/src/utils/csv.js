export function csvEscape(s) {
  const x = String(s ?? '');
  if (/[",\n\r]/.test(x)) return `"${x.replace(/"/g, '""')}"`;
  return x;
}

export function formatExportCell(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}
