import { useEffect, useRef, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ZoomIn, ZoomOut } from "lucide-react";
import { cropAnimatedGif } from "@/lib/gif-crop";

interface AvatarCropDialogProps {
  open: boolean;
  file: File | null;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
  aspect?: number; // width / height, default 1
  shape?: "circle" | "rect";
  title?: string;
  outputWidth?: number; // exported width in px
}

const MAX_BOX = 320;

const getVisibleCrop = (width: number, height: number, cropShape: "circle" | "rect") => {
  if (cropShape === "circle") {
    const size = Math.min(width, height);
    return {
      width: size,
      height: size,
      left: (width - size) / 2,
      top: (height - size) / 2,
    };
  }

  return { width, height, left: 0, top: 0 };
};

export default function AvatarCropDialog({
  open,
  file,
  onCancel,
  onCropped,
  aspect = 1,
  shape = "circle",
  title = "Crop your image",
  outputWidth = 512,
}: AvatarCropDialogProps) {
  // Compute preview box dimensions from aspect, keeping the larger side at MAX_BOX
  const boxW = aspect >= 1 ? MAX_BOX : MAX_BOX * aspect;
  const boxH = aspect >= 1 ? MAX_BOX / aspect : MAX_BOX;

  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [coverZoom, setCoverZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (!file) {
      setImgSrc(null);
      setImg(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!imgSrc) return;
    const image = new Image();
    image.onload = () => {
      const visibleCrop = getVisibleCrop(boxW, boxH, shape);
      // Cover: image fills the actual visible crop region by default.
      const cover = Math.max(visibleCrop.width / image.width, visibleCrop.height / image.height);
      setImg(image);
      setMinZoom(cover);
      setCoverZoom(cover);
      setZoom(cover);
      setOffset({ x: 0, y: 0 });
    };
    image.src = imgSrc;
  }, [imgSrc, boxW, boxH, shape, aspect]);

  const clampOffset = useCallback(
    (x: number, y: number, z: number) => {
      if (!img) return { x, y };
      const visibleCrop = getVisibleCrop(boxW, boxH, shape);
      const maxX = Math.max(0, (img.width * z - visibleCrop.width) / 2);
      const maxY = Math.max(0, (img.height * z - visibleCrop.height) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    },
    [img, boxW, boxH, shape]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clampOffset(dragRef.current.ox + dx, dragRef.current.oy + dy, zoom));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
  };

  const handleZoom = (val: number[]) => {
    const z = val[0];
    setZoom(z);
    setOffset((o) => clampOffset(o.x, o.y, z));
  };

  const handleSave = async () => {
    if (!img) return;
    setSaving(true);
    try {
      const visibleCrop = getVisibleCrop(boxW, boxH, shape);
      const outputHeight = Math.round(outputWidth * (visibleCrop.height / visibleCrop.width));
      const srcW = visibleCrop.width / zoom;
      const srcH = visibleCrop.height / zoom;
      const cx = img.width / 2 - offset.x / zoom;
      const cy = img.height / 2 - offset.y / zoom;
      const sx = cx - srcW / 2;
      const sy = cy - srcH / 2;

      if (file && file.type === "image/gif") {
        const blob = await cropAnimatedGif(file, {
          sx, sy, sw: srcW, sh: srcH,
          outWidth: outputWidth, outHeight: outputHeight,
        });
        onCropped(blob);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, outputWidth, outputHeight);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas empty"))), "image/jpeg", 0.92)
      );
      onCropped(blob);
    } finally {
      setSaving(false);
    }
  };

  const maxZoom = Math.max(coverZoom * 4, minZoom + 0.01);

  const overlayStyle: React.CSSProperties =
    shape === "circle"
      ? {
          background:
            "radial-gradient(circle closest-side at center, transparent 0, transparent calc(100% - 1px), rgba(0,0,0,0.6) 100%)",
        }
      : {
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.6) inset",
        };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            className="relative overflow-hidden rounded-md bg-muted touch-none select-none"
            style={{ width: boxW, height: boxH, maxWidth: "100%", cursor: "grab" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {img && (
              <img
                src={img.src}
                alt=""
                draggable={false}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: img.width * zoom,
                  height: img.height * zoom,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                  maxWidth: "none",
                  userSelect: "none",
                  pointerEvents: "none",
                }}
              />
            )}
            <div className="absolute inset-0 pointer-events-none" style={overlayStyle} />
          </div>

          {/* Preview removed per user request */}

          <div className="flex items-center gap-3 w-full px-2">
            <ZoomOut className="h-4 w-4 text-muted-foreground shrink-0" />
            <Slider
              value={[zoom]}
              min={minZoom}
              max={maxZoom}
              step={(maxZoom - minZoom) / 100 || 0.01}
              onValueChange={handleZoom}
              className="flex-1"
            />
            <ZoomIn className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!img || saving}>
            {saving ? "Saving..." : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
