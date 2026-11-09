import { supabase } from "@/integrations/supabase/client";

const CHAT_BUCKETS = ["chat-images", "chat-videos", "chat-voice"];
const DEFAULT_EXPIRES_IN_SECONDS = 60 * 60 * 6; // 6 hours
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const signingRequests = new Map<string, Promise<string>>();

export interface FileMeta {
  url: string;
  name: string;
  size: number;
  mime: string;
}

export interface MusicMeta {
  url: string;
  name: string;
  size: number;
}

function b64urlEncode(s: string): string {
  // unicode-safe
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeFile(meta: FileMeta): string {
  return `file:${b64urlEncode(JSON.stringify(meta))}`;
}

export function decodeFile(item: string): FileMeta | null {
  if (!item.startsWith("file:")) return null;
  try {
    return JSON.parse(b64urlDecode(item.slice(5))) as FileMeta;
  } catch {
    return null;
  }
}

export function encodeMusic(meta: MusicMeta): string {
  return `music:${b64urlEncode(JSON.stringify(meta))}`;
}

export function decodeMusic(item: string): MusicMeta | null {
  if (!item.startsWith("music:")) return null;
  try {
    return JSON.parse(b64urlDecode(item.slice(6))) as MusicMeta;
  } catch {
    return null;
  }
}

function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(
      /\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/]+)\/(.+)$/
    );
    if (!m) return null;
    const bucket = decodeURIComponent(m[1]);
    if (!CHAT_BUCKETS.includes(bucket)) return null;
    const path = decodeURIComponent(m[2]);
    return { bucket, path };
  } catch {
    return null;
  }
}

export async function signChatUrl(
  url: string,
  expiresIn: number = DEFAULT_EXPIRES_IN_SECONDS
): Promise<string> {
  const parsed = parseStorageUrl(url);
  if (!parsed) return url;
  const cached = signedUrlCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const inFlight = signingRequests.get(url);
  if (inFlight) return inFlight;

  const request = (async () => {
    const { data, error } = await supabase.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.path, expiresIn);
    if (error || !data?.signedUrl) return url;
    if (signedUrlCache.size >= 500) signedUrlCache.delete(signedUrlCache.keys().next().value!);
    signedUrlCache.set(url, { url: data.signedUrl, expiresAt: Date.now() + expiresIn * 1000 - 60_000 });
    return data.signedUrl;
  })();
  signingRequests.set(url, request);
  try {
    return await request;
  } finally {
    if (signingRequests.get(url) === request) signingRequests.delete(url);
  }
}

export async function signMessageMedia(
  serialized: string | null | undefined
): Promise<string | null> {
  if (!serialized) return serialized ?? null;
  let arr: string[];
  try {
    const parsed = JSON.parse(serialized);
    arr = Array.isArray(parsed) ? parsed : [serialized];
  } catch {
    arr = [serialized];
  }

  const signed = await Promise.all(
    arr.map(async (item) => {
      if (item.startsWith("audio:")) {
        const without = item.slice(6);
        const lastColon = without.lastIndexOf(":");
        const rawUrl = lastColon > 0 ? without.slice(0, lastColon) : without;
        const tail = lastColon > 0 ? without.slice(lastColon + 1) : "";
        const newUrl = await signChatUrl(rawUrl);
        return tail ? `audio:${newUrl}:${tail}` : `audio:${newUrl}`;
      }
      if (item.startsWith("video:")) {
        const rawUrl = item.slice(6);
        const newUrl = await signChatUrl(rawUrl);
        return `video:${newUrl}`;
      }
      if (item.startsWith("music:")) {
        const meta = decodeMusic(item);
        if (!meta) return item;
        return encodeMusic({ ...meta, url: await signChatUrl(meta.url) });
      }
      if (item.startsWith("file:")) {
        const meta = decodeFile(item);
        if (!meta) return item;
        return encodeFile({ ...meta, url: await signChatUrl(meta.url) });
      }
      if (item.startsWith("expired:")) {
        return item;
      }
      return await signChatUrl(item);
    })
  );

  return JSON.stringify(signed);
}
