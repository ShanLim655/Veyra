// Per-device GIF favorites for the picker. Stored in localStorage so they
// survive reloads without needing a server round trip; keyed by GIF id so a
// favorite keeps working even if GIPHY metadata changes.
import type { GifItem } from "./giphy";

const STORAGE_KEY = "veyra:gif-favorites:v1";
const MAX_FAVORITES = 100;
const listeners = new Set<() => void>();

function read(): GifItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isGifItem) : [];
  } catch {
    return [];
  }
}

function isGifItem(value: unknown): value is GifItem {
  const item = value as GifItem | null;
  return Boolean(item && typeof item.id === "string" && item.id && typeof item.sendUrl === "string" && item.sendUrl);
}

function write(items: GifItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_FAVORITES)));
  } catch {
    // Storage full or unavailable — favorites just won't persist.
  }
  listeners.forEach((listener) => listener());
}

export function getFavoriteGifs(): GifItem[] {
  return read();
}

export function isFavoriteGif(id: string): boolean {
  return read().some((item) => item.id === id);
}

export function toggleFavoriteGif(gif: GifItem): boolean {
  const items = read();
  const index = items.findIndex((item) => item.id === gif.id);
  if (index >= 0) {
    items.splice(index, 1);
    write(items);
    return false;
  }
  write([gif, ...items]);
  return true;
}

export function subscribeGifFavorites(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
