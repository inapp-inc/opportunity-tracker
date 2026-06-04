export function formatMoney(amount: number, currencyCode = "USD") {
  const code = (currencyCode || "USD").toUpperCase();
  const value = Number.isFinite(amount) ? amount : 0;
  return `${code} ${Math.round(value).toLocaleString()}`;
}

export function formatDashboardMetric(
  value: number,
  field?: string,
  currencyCode = "USD"
) {
  if (field === "value") return formatMoney(value, currencyCode);
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

export function formatDateTimeInZone(iso: string, timeZone: string) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timeZone || "UTC",
    }).format(new Date(iso));
  } catch {
    return iso.replace("T", " ").slice(0, 16);
  }
}

export function displayNameFromUser(user: {
  name?: string;
  email?: string;
} | null | undefined) {
  const name = String(user?.name || "").trim();
  if (name) return name;
  return user?.email || "";
}

export function initialsFromDisplayName(name: string, email?: string) {
  const trimmed = name.trim();
  if (trimmed && !trimmed.includes("@")) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return (trimmed.slice(0, 2) || "?").toUpperCase();
  }
  const local = (email || trimmed).split("@")[0] || "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (local.slice(0, 2) || "?").toUpperCase();
}
