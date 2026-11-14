import { describe, expect, it, vi } from "vitest";
import { sendGifMessage, type GifSendOptions } from "./gifSend";

interface TestPreview {
  file: File;
  tag: string;
}

interface TestReply {
  id: string;
}

const GIF = { id: "gif123", sendUrl: "https://media.giphy.com/x/giphy.gif" };

function gifBlob() {
  return new Blob(["gif-bytes"], { type: "image/gif" });
}

function makeOptions(
  overrides: Partial<GifSendOptions<TestPreview, TestReply>> = {},
) {
  const calls = {
    dispatch: [] as Array<{
      content: string;
      previews: TestPreview[];
      reply: TestReply | null;
    }>,
    errors: [] as unknown[],
    busyLog: [] as boolean[],
  };
  let busy = false;
  const options: GifSendOptions<TestPreview, TestReply> = {
    state: { content: "", previews: [], reply: null },
    isBusy: () => busy,
    setBusy: (value) => {
      busy = value;
      calls.busyLog.push(value);
    },
    dispatch: vi.fn(async (content, previews, reply) => {
      calls.dispatch.push({ content, previews, reply });
    }),
    onError: vi.fn((error) => {
      calls.errors.push(error);
    }),
    fetchBlob: vi.fn(async () => gifBlob()),
    createPreview: (file) => ({ file, tag: "gif" }),
    ...overrides,
  };
  return { options, calls, isBusy: () => busy };
}

describe("sendGifMessage", () => {
  it("sends a GIF with an existing draft as content", async () => {
    const { options, calls } = makeOptions({
      state: { content: "check this out", previews: [], reply: null },
    });

    await sendGifMessage(GIF, options);

    expect(calls.dispatch).toHaveLength(1);
    expect(calls.dispatch[0].content).toBe("check this out");
    expect(calls.dispatch[0].previews).toHaveLength(1);
    expect(calls.dispatch[0].previews[0].file.name).toBe("gif123.gif");
    expect(calls.dispatch[0].previews[0].file.type).toBe("image/gif");
    expect(calls.errors).toHaveLength(0);
  });

  it("appends the GIF after already-queued attachments", async () => {
    const queued: TestPreview[] = [
      { file: new File(["a"], "a.png", { type: "image/png" }), tag: "image" },
      { file: new File(["b"], "b.mp4", { type: "video/mp4" }), tag: "video" },
    ];
    const { options, calls } = makeOptions({
      state: { content: "", previews: queued, reply: null },
    });

    await sendGifMessage(GIF, options);

    expect(calls.dispatch[0].previews.map((p) => p.tag)).toEqual([
      "image",
      "video",
      "gif",
    ]);
    // The queued preview objects are passed through untouched.
    expect(calls.dispatch[0].previews[0]).toBe(queued[0]);
    expect(calls.dispatch[0].previews[1]).toBe(queued[1]);
  });

  it("preserves the reply target", async () => {
    const reply: TestReply = { id: "msg-1" };
    const { options, calls } = makeOptions({
      state: { content: "", previews: [], reply },
    });

    await sendGifMessage(GIF, options);

    expect(calls.dispatch[0].reply).toBe(reply);
  });

  it("ignores selection while the composer is busy (preset/reply guards share this gate)", async () => {
    const { options, calls } = makeOptions();
    options.isBusy = () => true;

    await sendGifMessage(GIF, options);

    expect(options.fetchBlob).not.toHaveBeenCalled();
    expect(options.dispatch).not.toHaveBeenCalled();
    expect(calls.busyLog).toHaveLength(0);
  });

  it("blocks a second GIF send while the first download is in flight", async () => {
    let resolveFetch: ((blob: Blob) => void) | null = null;
    const { options } = makeOptions({
      fetchBlob: vi.fn(
        () =>
          new Promise<Blob>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    });

    const first = sendGifMessage(GIF, options);
    // Second selection while busy must no-op.
    await sendGifMessage({ id: "other", sendUrl: "https://x.test/o.gif" }, options);
    resolveFetch!(gifBlob());
    await first;

    expect(options.dispatch).toHaveBeenCalledTimes(1);
  });

  it("reports a failed download without dispatching and resets busy", async () => {
    const failure = new Error("Download failed (404).");
    const { options, calls, isBusy } = makeOptions({
      fetchBlob: vi.fn(async () => {
        throw failure;
      }),
    });

    await sendGifMessage(GIF, options);

    expect(options.dispatch).not.toHaveBeenCalled();
    expect(calls.errors).toEqual([failure]);
    expect(isBusy()).toBe(false);
    expect(calls.busyLog).toEqual([true, false]);
  });

  it("surfaces a failed upload/dispatch and resets busy", async () => {
    const failure = new Error("upload exploded");
    const { options, calls, isBusy } = makeOptions({
      dispatch: vi.fn(async () => {
        throw failure;
      }),
    });

    await sendGifMessage(GIF, options);

    expect(calls.errors).toEqual([failure]);
    expect(isBusy()).toBe(false);
  });

  it("dispatches once with draft, queued previews, GIF, and reply combined", async () => {
    const queued: TestPreview[] = [
      { file: new File(["q"], "q.png", { type: "image/png" }), tag: "image" },
    ];
    const reply: TestReply = { id: "msg-9" };
    const { options, calls, isBusy } = makeOptions({
      state: { content: "caption", previews: queued, reply },
    });

    await sendGifMessage(GIF, options);

    expect(calls.dispatch).toHaveLength(1);
    const sent = calls.dispatch[0];
    expect(sent.content).toBe("caption");
    expect(sent.previews).toHaveLength(2);
    expect(sent.previews[1].tag).toBe("gif");
    expect(sent.reply).toBe(reply);
    expect(isBusy()).toBe(false);
  });
});
