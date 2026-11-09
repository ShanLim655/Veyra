// Lightweight client-side cooldown helper backed by localStorage.
// NOTE: This is best-effort spam protection only — it can be bypassed by
// clearing storage. Use server-side limits for security-critical rate limits.

export const getCooldownRemaining = (key: string): number => {
  if (typeof window === "undefined") return 0;
  const until = Number(localStorage.getItem(key)) || 0;
  return Math.max(0, until - Date.now());
};

export const setCooldown = (key: string, ms: number) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, String(Date.now() + ms));
};

export const formatCooldown = (ms: number): string => {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
};

// Reactive countdown hook
import { useEffect, useState } from "react";

export const useCooldown = (key: string) => {
  const [remaining, setRemaining] = useState(() => getCooldownRemaining(key));

  useEffect(() => {
    setRemaining(getCooldownRemaining(key));
    const id = setInterval(() => {
      const r = getCooldownRemaining(key);
      setRemaining(r);
      if (r <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [key]);

  const trigger = (ms: number) => {
    setCooldown(key, ms);
    setRemaining(ms);
  };

  return { remaining, trigger };
};
