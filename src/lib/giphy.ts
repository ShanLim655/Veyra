// GIPHY GIF search for the chat composer. Set VITE_GIPHY_API_KEY at build
// time for a production key; the public beta key is the fallback so the
// picker works out of the box (rate-limited).

const API_KEY =
  (import.meta.env.VITE_GIPHY_API_KEY as string | undefined)?.trim() ||
  "dc6zaTOxFJmzC";
const BASE_URL = "https://api.giphy.com/v1/gifs";
const PAGE_SIZE = 24;

export interface GifItem {
  id: string;
  title: string;
  /** Small preview used in the picker grid. */
  previewUrl: string;
  /** Full animated GIF fetched and re-uploaded to chat storage on send. */
  sendUrl: string;
  width: number;
  height: number;
}

interface GiphyImageAsset {
  url?: string;
  width?: string;
  height?: string;
}

interface GiphyImages {
  fixed_width?: GiphyImageAsset;
  fixed_width_small?: GiphyImageAsset;
  downsized?: GiphyImageAsset;
  downsized_medium?: GiphyImageAsset;
  original?: GiphyImageAsset;
}

interface GiphyGif {
  id?: string;
  title?: string;
  images?: GiphyImages;
}

function toGifItem(gif: GiphyGif): GifItem | null {
  const images = gif.images;
  const sendUrl =
    images?.downsized_medium?.url ||
    images?.downsized?.url ||
    images?.original?.url;
  if (!gif.id || !sendUrl) return null;
  const preview = images?.fixed_width || images?.fixed_width_small;
  const dims = images?.downsized_medium || images?.downsized || images?.original;
  return {
    id: gif.id,
    title: gif.title || "GIF",
    previewUrl: preview?.url || sendUrl,
    sendUrl,
    width: parseInt(dims?.width || "0", 10) || 0,
    height: parseInt(dims?.height || "0", 10) || 0,
  };
}

async function fetchGifs(
  endpoint: "search" | "trending",
  params: Record<string, string> = {},
): Promise<GifItem[]> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("rating", "pg-13");
  url.searchParams.set("lang", "en");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`GIF search failed (${response.status}).`);
  }
  const payload = (await response.json()) as { data?: GiphyGif[] };
  return (payload.data || [])
    .map(toGifItem)
    .filter((item): item is GifItem => item !== null);
}

export function searchGifs(query: string): Promise<GifItem[]> {
  return fetchGifs("search", { q: query });
}

export function fetchTrendingGifs(): Promise<GifItem[]> {
  return fetchGifs("trending");
}
