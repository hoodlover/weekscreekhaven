#!/usr/bin/env python3
"""Create branded public images from a private, ignored archive of originals.

The script is intentionally idempotent: once an original is archived, every
later run rebuilds the public image from that archived source. Watermarks do
not accumulate when the command is run more than once.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageStat


IMAGE_SUFFIXES = {".avif", ".jpeg", ".jpg", ".png", ".webp"}
COPYRIGHT_TEXT = "© 2026 Weeks Creek Haven"
COPYRIGHT_METADATA = "Copyright 2026 Weeks Creek Haven"
GALLERY_NAME = "WEEKS CREEK HAVEN"
GALLERY_URL = "weekscreekhaven.com"
GUIDE_FOOTER = f"{COPYRIGHT_TEXT} • {GALLERY_URL} • Guest Guide"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def image_files(root: Path, folder: str) -> list[Path]:
    return sorted(
        path
        for path in (root / folder).rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )


def fit_font(text: str, font_path: Path, max_width: int, initial_size: int) -> ImageFont.FreeTypeFont:
    size = max(8, initial_size)
    while size > 8:
        font = ImageFont.truetype(str(font_path), size)
        box = font.getbbox(text, stroke_width=1)
        if box[2] - box[0] <= max_width:
            return font
        size -= 1
    return ImageFont.truetype(str(font_path), 8)


def centered_x(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int) -> int:
    box = draw.textbbox((0, 0), text, font=font, stroke_width=1)
    return round((width - (box[2] - box[0])) / 2 - box[0])


def add_gallery_watermark(source: Image.Image, bold_font: Path, regular_font: Path) -> Image.Image:
    base = source.convert("RGBA")
    width, height = base.size
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Deliberately restrained: roughly half-image width and barely visible.
    name_font = fit_font(GALLERY_NAME, bold_font, round(width * 0.50), round(width * 0.048))
    url_font = fit_font(GALLERY_URL, regular_font, round(width * 0.31), round(width * 0.026))
    name_box = draw.textbbox((0, 0), GALLERY_NAME, font=name_font, stroke_width=1)
    url_box = draw.textbbox((0, 0), GALLERY_URL, font=url_font, stroke_width=1)
    name_height = name_box[3] - name_box[1]
    url_height = url_box[3] - url_box[1]
    gap = max(2, round(height * 0.008))
    total_height = name_height + gap + url_height
    top = round(height * 0.72 - total_height / 2)

    name_x = centered_x(draw, GALLERY_NAME, name_font, width)
    url_x = centered_x(draw, GALLERY_URL, url_font, width)
    shadow = (15, 12, 9, 24)
    ivory_name = (248, 239, 219, 31)
    ivory_url = (248, 239, 219, 43)

    draw.text(
        (name_x, top),
        GALLERY_NAME,
        font=name_font,
        fill=ivory_name,
        stroke_width=1,
        stroke_fill=shadow,
    )
    draw.text(
        (url_x, top + name_height + gap),
        GALLERY_URL,
        font=url_font,
        fill=ivory_url,
        stroke_width=1,
        stroke_fill=shadow,
    )
    return Image.alpha_composite(base, overlay).convert("RGB")


def blended_parchment(source: Image.Image) -> tuple[int, int, int]:
    rgb = source.convert("RGB")
    width, height = rgb.size
    sample_height = max(1, round(height * 0.025))
    stats = ImageStat.Stat(rgb.crop((0, height - sample_height, width, height)))
    sampled = tuple(int(value) for value in stats.median[:3])
    parchment = (236, 220, 184)
    return tuple(round(sampled[i] * 0.35 + parchment[i] * 0.65) for i in range(3))


def add_guide_footer(source: Image.Image, regular_font: Path) -> Image.Image:
    original = source.convert("RGB")
    width, height = original.size
    footer_height = max(30, round(height * 0.052))
    background = blended_parchment(original)
    result = Image.new("RGB", (width, height + footer_height), background)
    result.paste(original, (0, 0))
    draw = ImageDraw.Draw(result)

    rule_color = (103, 76, 48)
    text_color = (69, 50, 33)
    rule_width = max(1, round(width / 700))
    draw.line((0, height, width, height), fill=rule_color, width=rule_width)

    font = fit_font(GUIDE_FOOTER, regular_font, round(width * 0.92), round(footer_height * 0.38))
    box = draw.textbbox((0, 0), GUIDE_FOOTER, font=font)
    text_width = box[2] - box[0]
    text_height = box[3] - box[1]
    x = round((width - text_width) / 2 - box[0])
    y = height + round((footer_height - text_height) / 2 - box[1])
    draw.text((x, y), GUIDE_FOOTER, font=font, fill=text_color)
    return result


def save_image(image: Image.Image, destination: Path, source: Image.Image) -> None:
    suffix = destination.suffix.lower()
    temporary = destination.with_name(f"{destination.stem}.watermark-tmp{destination.suffix}")
    metadata: dict[str, object] = {}
    icc = source.info.get("icc_profile")
    if icc:
        metadata["icc_profile"] = icc

    exif = source.getexif()
    exif[270] = f"Weeks Creek Haven website image - {GALLERY_URL}"
    exif[315] = "Weeks Creek Haven"
    exif[33432] = COPYRIGHT_METADATA
    metadata["exif"] = exif.tobytes()

    try:
        if suffix == ".webp":
            image.save(temporary, "WEBP", quality=84, method=6, **metadata)
        elif suffix in {".jpg", ".jpeg"}:
            image.save(temporary, "JPEG", quality=90, optimize=True, progressive=True, **metadata)
        elif suffix == ".png":
            image.save(temporary, "PNG", optimize=True, **metadata)
        elif suffix == ".avif":
            image.save(temporary, "AVIF", quality=84, **metadata)
        else:
            raise ValueError(f"Unsupported image type: {destination}")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument(
        "--archive",
        type=Path,
        default=Path("_private/image-originals/pre-watermark-2026-08-31"),
    )
    parser.add_argument("--font", type=Path, default=Path(r"C:\Windows\Fonts\georgia.ttf"))
    parser.add_argument("--bold-font", type=Path, default=Path(r"C:\Windows\Fonts\georgiab.ttf"))
    args = parser.parse_args()

    root = args.root.resolve()
    archive_root = (root / args.archive).resolve()
    if root not in archive_root.parents:
        raise SystemExit("Archive must be inside the project root")
    if not args.font.is_file() or not args.bold_font.is_file():
        raise SystemExit("Required Georgia fonts were not found")

    files = image_files(root, "gallery") + image_files(root, "info")
    if not files:
        raise SystemExit("No gallery or info images found")

    manifest: dict[str, object] = {
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "copyright": COPYRIGHT_TEXT,
        "files": [],
    }

    for public_path in files:
        relative = public_path.relative_to(root)
        archived_path = archive_root / relative
        archived_path.parent.mkdir(parents=True, exist_ok=True)
        if not archived_path.exists():
            with Image.open(public_path) as candidate:
                if candidate.getexif().get(33432) == COPYRIGHT_METADATA:
                    raise SystemExit(
                        f"Refusing to archive an already-watermarked file: {relative}. "
                        "Restore the private originals archive before rebuilding."
                    )
            shutil.copy2(public_path, archived_path)

        original_hash = sha256(archived_path)
        with Image.open(archived_path) as source:
            source.load()
            original_size = source.size
            if relative.parts[0].lower() == "gallery":
                output = add_gallery_watermark(source, args.bold_font, args.font)
                treatment = "gallery-watermark"
            else:
                output = add_guide_footer(source, args.font)
                treatment = "guide-footer"
            save_image(output, public_path, source)
            output_size = output.size

        manifest["files"].append(
            {
                "path": relative.as_posix(),
                "archive_sha256": original_hash,
                "original_size": list(original_size),
                "output_size": list(output_size),
                "treatment": treatment,
            }
        )
        print(f"{treatment:17} {relative}")

    archive_root.mkdir(parents=True, exist_ok=True)
    manifest_path = archive_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Processed {len(files)} images")
    print(f"Originals: {archive_root}")
    print(f"Manifest:  {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
