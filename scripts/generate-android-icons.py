"""Regenerate app icons from public/favicon.ico.

Usage: python scripts/generate-android-icons.py

Writes Android launcher PNGs into resources/android-icons/ and a multi-size
Windows .ico into resources/veyra-icon.ico (electron-builder requires icons
of at least 256x256, which favicon.ico does not provide).
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public" / "favicon.ico"
RES = ROOT / "android" / "app" / "src" / "main" / "res"
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}

LAUNCHER_DP = 48
FOREGROUND_DP = 108
# Adaptive-icon safe zone is roughly the inner 72dp of the 108dp canvas.
FOREGROUND_SCALE = 0.66


def load_source() -> Image.Image:
    icon = Image.open(SOURCE)
    # Pick the largest frame for the best upscale quality.
    best = icon
    for i in range(getattr(icon, "n_frames", 1)):
        icon.seek(i)
        frame = icon.convert("RGBA")
        if frame.width * frame.height > best.width * best.height:
            best = frame.copy()
    return best


def rounded(img: Image.Image, size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0))
    out.putalpha(mask)
    return out


def main() -> None:
    src = load_source()
    for density, scale in DENSITIES.items():
        res_dir = RES / f"mipmap-{density}"
        launcher_px = int(LAUNCHER_DP * scale)
        launcher = src.resize((launcher_px, launcher_px), Image.LANCZOS)
        launcher.save(res_dir / "ic_launcher.png")
        rounded(launcher, launcher_px).save(res_dir / "ic_launcher_round.png")

        fg_px = int(FOREGROUND_DP * scale)
        inner = int(fg_px * FOREGROUND_SCALE)
        fg = src.resize((inner, inner), Image.LANCZOS)
        canvas = Image.new("RGBA", (fg_px, fg_px), (0, 0, 0, 0))
        offset = (fg_px - inner) // 2
        canvas.paste(fg, (offset, offset), fg)
        canvas.save(res_dir / "ic_launcher_foreground.png")
        print(f"{density}: launcher={launcher_px}px foreground={fg_px}px")

    # Multi-size .ico for electron-builder (it rejects icons below 256px).
    src_256 = src.resize((256, 256), Image.LANCZOS)
    src_256.save(
        ROOT / "resources" / "veyra-icon.ico",
        format="ICO",
        sizes=ICO_SIZES,
    )
    print("resources/veyra-icon.ico written")


if __name__ == "__main__":
    main()
