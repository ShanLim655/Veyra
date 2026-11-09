import { parseGIF, decompressFrames } from "gifuct-js";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

export interface GifCropOptions {
  // Source crop rectangle in image-pixel coordinates
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  outWidth: number;
  outHeight: number;
}

/**
 * Crop an animated GIF while preserving all frames, timings and looping.
 */
export async function cropAnimatedGif(file: File | Blob, opts: GifCropOptions): Promise<Blob> {
  const buf = await file.arrayBuffer();
  const gif = parseGIF(buf);
  const frames = decompressFrames(gif, true);
  if (frames.length === 0) throw new Error("No frames in GIF");

  const fullW = (gif as any).lsd?.width ?? frames[0].dims.width;
  const fullH = (gif as any).lsd?.height ?? frames[0].dims.height;

  // Composite each frame onto a full-size canvas to handle disposal/partial frames
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = fullW;
  fullCanvas.height = fullH;
  const fullCtx = fullCanvas.getContext("2d")!;

  // Output (cropped) canvas
  const outCanvas = document.createElement("canvas");
  outCanvas.width = opts.outWidth;
  outCanvas.height = opts.outHeight;
  const outCtx = outCanvas.getContext("2d")!;
  outCtx.imageSmoothingQuality = "high";

  const encoder = GIFEncoder();

  let prevImageData: ImageData | null = null;

  for (const frame of frames) {
    const { dims, patch, delay, disposalType } = frame as any;

    // Save state for disposal type 3 (restore to previous)
    if (disposalType === 3) {
      prevImageData = fullCtx.getImageData(0, 0, fullW, fullH);
    }

    // Draw frame patch onto full canvas
    const frameImageData = new ImageData(new Uint8ClampedArray(patch), dims.width, dims.height);
    const tmp = document.createElement("canvas");
    tmp.width = dims.width;
    tmp.height = dims.height;
    tmp.getContext("2d")!.putImageData(frameImageData, 0, 0);
    fullCtx.drawImage(tmp, dims.left, dims.top);

    // Draw cropped/scaled region into output canvas
    outCtx.clearRect(0, 0, opts.outWidth, opts.outHeight);
    outCtx.drawImage(
      fullCanvas,
      opts.sx, opts.sy, opts.sw, opts.sh,
      0, 0, opts.outWidth, opts.outHeight
    );

    const outData = outCtx.getImageData(0, 0, opts.outWidth, opts.outHeight);
    const palette = quantize(outData.data, 256, { format: "rgb565" });
    const index = applyPalette(outData.data, palette, "rgb565");
    encoder.writeFrame(index, opts.outWidth, opts.outHeight, {
      palette,
      delay: delay || 100,
    });

    // Apply disposal
    if (disposalType === 2) {
      // Restore to background (transparent)
      fullCtx.clearRect(dims.left, dims.top, dims.width, dims.height);
    } else if (disposalType === 3 && prevImageData) {
      fullCtx.putImageData(prevImageData, 0, 0);
    }
  }

  encoder.finish();
  return new Blob([encoder.bytes()], { type: "image/gif" });
}
