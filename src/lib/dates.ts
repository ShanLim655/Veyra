// The API returns DATETIME columns as ISO-8601 strings, but some rows and
// realtime payloads still carry the legacy "YYYY-MM-DD HH:MM:SS(.sss)" shape.
// `new Date()` parses that inconsistently (Invalid Date on Safari/JSC, local
// time elsewhere), so normalize everything through here. Server times are
// stored in UTC.
const SERVER_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)$/;

export function parseServerDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const match = SERVER_DATETIME.exec(value.trim());
  const normalized = match ? `${match[1]}T${match[2]}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function serverDateMs(value: string | number | Date | null | undefined): number {
  return parseServerDate(value)?.getTime() ?? Number.NaN;
}
