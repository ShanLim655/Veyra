// Client-side image compression for chat uploads.
// Goal: never upload raw multi-MB originals. Re-encode to WebP (with AVIF
// attempt where supported) and downscale oversized images.

const MAX_DIMENSION = 1920; // px on the longest edge
const TARGET_QUALITY = 0.82;
// If the encoded output isn't meaningfully smaller than the original, keep the original.
const MIN_SAVINGS_RATIO = 0.9;

const SKIP_MIME = new Set([
  "image/gif", // animated frames would be lost
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

let avifSupportPromise: Promise<boolean> | null = null;
function supportsAvifEncode(): Promise<boolean> {
  if (avifSupportPromise) return avifSupportPromise;
  avifSupportPromise = new Promise((resolve) => {
    try {
      const c = document.createElement("canvas");
      c.width = 2;
      c.height = 2;
      c.toBlob(
        (b) => resolve(!!b && b.type === "image/avif"),
        "image/avif",
        0.8,
      );
    } catch {
      resolve(false);
    }
  });
  return avifSupportPromise;
}

async function loadBitmap(file: File): Promise<{
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  close: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(file);
    return {
      width: bmp.width,
      height: bmp.height,
      draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
      close: () => bmp.close?.(),
    };
  }
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = url;
  });
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    close: () => URL.revokeObjectURL(url),
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (SKIP_MIME.has(file.type)) return file;

  try {
    const bmp = await loadBitmap(file);
    try {
      const scale = Math.min(1, MAX_DIMENSION / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) return file;
      bmp.draw(ctx, w, h);

      // Try AVIF first when the browser can actually encode it, then WebP.
      const candidates: Array<{ type: string; ext: string }> = [];
      if (await supportsAvifEncode()) {
        candidates.push({ type: "image/avif", ext: "avif" });
      }
      candidates.push({ type: "image/webp", ext: "webp" });

      let best: { blob: Blob; ext: string } | null = null;
      for (const c of candidates) {
        const blob = await canvasToBlob(canvas, c.type, TARGET_QUALITY);
        if (blob && blob.type === c.type) {
          if (!best || blob.size < best.blob.size) {
            best = { blob, ext: c.ext };
          }
          // AVIF is the smallest target; stop after first success.
          if (c.type === "image/avif") break;
        }
      }

      if (!best) return file;
      if (best.blob.size >= file.size * MIN_SAVINGS_RATIO) return file;

      const baseName = file.name.replace(/\.[^.]+$/, "");
      return new File([best.blob], `${baseName}.${best.ext}`, {
        type: best.blob.type,
        lastModified: Date.now(),
      });
    } finally {
      bmp.close();
    }
  } catch {
    return file;
  }
}
