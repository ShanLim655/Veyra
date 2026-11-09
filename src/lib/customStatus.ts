export interface CustomStatusData {
  custom_status_text: string | null;
  custom_status_emoji: string | null;
  custom_status_expires_at: string | null;
}

export function isStatusActive(s: Partial<CustomStatusData> | null | undefined): boolean {
  if (!s) return false;
  if (!s.custom_status_text) return false;
  if (!s.custom_status_expires_at) return true;
  return new Date(s.custom_status_expires_at).getTime() > Date.now();
}

export type DurationPreset = "1h" | "4h" | "24h" | "never" | "custom";

export const DURATION_PRESETS: { value: DurationPreset; label: string; ms: number | null }[] = [
  { value: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { value: "4h", label: "4 hours", ms: 4 * 60 * 60 * 1000 },
  { value: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { value: "never", label: "Don't clear", ms: null },
  { value: "custom", label: "Custom…", ms: 0 },
];

export function formatClearAt(date: Date): string {
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const dayMonth = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${dayMonth}, ${time}`;
}
