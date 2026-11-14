// Coordinates "send a GIF immediately" flows: snapshots the composer state,
// downloads the GIF asset, appends it to any queued previews, and dispatches
// through the normal message pipeline. Kept framework-free so the snapshot /
// merge / busy-guard / failure semantics are unit-testable.

export interface GifAsset {
  id: string;
  sendUrl: string;
}

export interface GifSendState<P, R> {
  content: string;
  previews: P[];
  reply: R | null;
}

export interface GifSendOptions<P, R> {
  /** Composer state captured before the async download begins. */
  state: GifSendState<P, R>;
  /** Returns true while the composer is busy (upload/download in flight). */
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
  /** Normal message dispatch (upload + insert). Owns restore-on-failure. */
  dispatch: (content: string, previews: P[], reply: R | null) => Promise<unknown>;
  onError: (error: unknown) => void;
  fetchBlob?: (url: string) => Promise<Blob>;
  createPreview: (file: File) => P;
}

async function defaultFetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  return response.blob();
}

/**
 * Downloads the GIF and dispatches it as a message. No-ops while the composer
 * is busy so a second selection cannot interleave with an in-flight send.
 * Never mutates the passed state; the caller owns all composer state.
 */
export async function sendGifMessage<P, R>(
  gif: GifAsset,
  options: GifSendOptions<P, R>,
): Promise<void> {
  if (options.isBusy()) return;
  options.setBusy(true);
  try {
    const blob = await (options.fetchBlob ?? defaultFetchBlob)(gif.sendUrl);
    const file = new File([blob], `${gif.id}.gif`, {
      type: blob.type.startsWith("image/") ? blob.type : "image/gif",
    });
    const gifPreview = options.createPreview(file);
    await options.dispatch(
      options.state.content,
      [...options.state.previews, gifPreview],
      options.state.reply,
    );
  } catch (error) {
    options.onError(error);
  } finally {
    options.setBusy(false);
  }
}
