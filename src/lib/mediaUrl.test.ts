import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/nativeSession", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "@/lib/nativeSession";
import {
  collectMediaUrls,
  decodeFile,
  decodeMusic,
  encodeFile,
  encodeMusic,
  prefetchChatUrls,
  signChatUrl,
  signMessageMedia,
} from "./mediaUrl";

const mockedApiFetch = vi.mocked(apiFetch);

function okJson(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

function failResponse() {
  return { ok: false, json: async () => ({}) } as unknown as Response;
}

const STORAGE_URL =
  "https://example.supabase.co/storage/v1/object/public/chat-images/user1/pic.png";

describe("media url encode/decode", () => {
  it("round-trips file and music metadata", () => {
    const file = encodeFile({ url: STORAGE_URL, name: "a.pdf", size: 12, mime: "application/pdf" });
    expect(decodeFile(file)).toEqual({ url: STORAGE_URL, name: "a.pdf", size: 12, mime: "application/pdf" });
    const music = encodeMusic({ url: STORAGE_URL, name: "song.mp3", size: 99 });
    expect(decodeMusic(music)).toEqual({ url: STORAGE_URL, name: "song.mp3", size: 99 });
  });
});

describe("collectMediaUrls", () => {
  it("extracts raw storage urls from every supported item kind", () => {
    const items = [
      STORAGE_URL,
      `video:${STORAGE_URL.replace("chat-images", "chat-videos")}`,
      `audio:${STORAGE_URL}:42`,
      encodeMusic({ url: STORAGE_URL, name: "s.mp3", size: 1 }),
      encodeFile({ url: STORAGE_URL, name: "f.zip", size: 1, mime: "application/zip" }),
      "expired:https://old.example/x.png",
    ];
    const urls = collectMediaUrls(JSON.stringify(items));
    expect(urls).toHaveLength(5);
    expect(urls).toContain(STORAGE_URL);
    expect(urls).toContain(STORAGE_URL.replace("chat-images", "chat-videos"));
    expect(urls.some((u) => u.includes("old.example"))).toBe(false);
  });

  it("handles a bare non-JSON url string", () => {
    expect(collectMediaUrls(STORAGE_URL)).toEqual([STORAGE_URL]);
    expect(collectMediaUrls(null)).toEqual([]);
    expect(collectMediaUrls(undefined)).toEqual([]);
  });
});

describe("signChatUrl / signMessageMedia", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it("returns non-storage urls unchanged without a request", async () => {
    expect(await signChatUrl("https://cdn.example.com/x.png")).toBe("https://cdn.example.com/x.png");
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it("signs a storage url through the chat-read endpoint", async () => {
    const signed = "https://example.supabase.co/storage/v1/object/sign/chat-images/signed.png?token=abc";
    mockedApiFetch.mockResolvedValueOnce(okJson({ url: signed }));
    // Unique path per run avoids the module-level signed-url cache.
    const url = STORAGE_URL.replace("pic.png", `sign-${Date.now()}-${Math.random()}.png`);
    expect(await signChatUrl(url)).toBe(signed);
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/api/storage/chat-read",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("degrades to the raw url when signing fails instead of throwing", async () => {
    mockedApiFetch.mockResolvedValue(failResponse());
    const url = STORAGE_URL.replace("pic.png", `fail-${Date.now()}-${Math.random()}.png`);
    expect(await signChatUrl(url)).toBe(url);
  });

  it("signMessageMedia rewrites every item kind and preserves wrappers", async () => {
    mockedApiFetch.mockImplementation(async (_input: any, init: any) => {
      const body = JSON.parse(init.body);
      if (body.items) {
        const urls = Object.fromEntries(
          body.items.map((i: any) => [`${i.bucket}/${i.path}`, `signed:${i.path}`]),
        );
        return okJson({ urls });
      }
      return okJson({ url: `signed:${body.path}` });
    });

    const image = STORAGE_URL.replace("pic.png", `multi-${Date.now()}-${Math.random()}.png`);
    const video = image.replace("chat-images", "chat-videos");
    const payload = JSON.stringify([
      image,
      `video:${video}`,
      `audio:${image}:17`,
      "expired:https://old.example/x.png",
    ]);
    const signed = JSON.parse((await signMessageMedia(payload))!) as string[];
    expect(signed[0]).toContain("signed:");
    expect(signed[1]).toMatch(/^video:signed:/);
    expect(signed[2]).toMatch(/^audio:signed:.*:17$/);
    expect(signed[3]).toBe("expired:https://old.example/x.png");
  });
});

describe("prefetchChatUrls", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it("batches storage urls into chunked chat-read requests and warms the cache", async () => {
    mockedApiFetch.mockImplementation(async (_input: any, init: any) => {
      const body = JSON.parse(init.body);
      const urls = Object.fromEntries(
        body.items.map((i: any) => [`${i.bucket}/${i.path}`, `signed:${i.path}`]),
      );
      return okJson({ urls });
    });

    const make = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        STORAGE_URL.replace("pic.png", `batch-${Date.now()}-${Math.random()}-${i}.png`),
      );
    const urls = make(120); // forces multiple 50-item chunks
    await prefetchChatUrls(urls);
    expect(mockedApiFetch).toHaveBeenCalledTimes(3);

    // A subsequent signChatUrl for a prefetched url resolves from cache.
    mockedApiFetch.mockClear();
    expect(await signChatUrl(urls[0])).toContain("signed:");
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it("swallows request failures so callers can fall back per-message", async () => {
    mockedApiFetch.mockRejectedValue(new Error("network down"));
    await expect(
      prefetchChatUrls([STORAGE_URL.replace("pic.png", `pre-${Date.now()}-${Math.random()}.png`)]),
    ).resolves.toBeUndefined();
  });
});
