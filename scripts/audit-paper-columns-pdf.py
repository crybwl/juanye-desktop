"""Check real exported PDF geometry plus rasterized sealing fields, not hidden DOM.

Run with the bundled Python after Poppler renders all PDF pages with a fresh
prefix, e.g. A3-final-<token>-1.png and 8K-final-<token>-1.png. Rendering must be
after the PDF export, so stale same-name PNGs cannot accidentally pass.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image
from pypdf import PdfReader


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--render-token", required=True)
    options = parser.parse_args()
    report = json.loads(options.report.read_text(encoding="utf-8"))
    checks = []
    for expected in report["pdfs"]:
        source = Path(expected["path"])
        label = source.stem.split("-")[0]
        pdf = PdfReader(source)
        images = sorted(source.parent.glob(f"{label}-{options.render_token}-*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
        assert len(pdf.pages) == expected["expectedPages"] == len(images), (label, "physical/raster/DOM page count mismatch")
        first_strip_hash = None
        page_checks = []
        for index, (page, image_path) in enumerate(zip(pdf.pages, images)):
            width_mm = float(page.mediabox.width) / 72 * 25.4
            height_mm = float(page.mediabox.height) / 72 * 25.4
            assert abs(width_mm - expected["expectedWidthMm"]) < .3, (label, index, width_mm)
            assert abs(height_mm - expected["expectedHeightMm"]) < .3, (label, index, height_mm)
            assert image_path.stat().st_mtime_ns >= source.stat().st_mtime_ns, (label, index, "stale PNG")
            text = page.extract_text() or ""
            labels = {"school": "学校", "class": "班级", "name": "姓名", "candidate": "考号"}
            label_counts = {name: text.count(value) for name, value in labels.items()}
            assert all(count >= 1 for count in label_counts.values()), (label, index + 1, "missing label text", label_counts)
            image = Image.open(image_path).convert("L")
            pixels_per_mm = image.width / expected["expectedWidthMm"]
            # Contains all four form labels and their writing lines, but excludes
            # the dashed seal / central warning / body. Blank fields fail even
            # if invisible PDF text still claims to contain the labels.
            box = (int(14 * pixels_per_mm), int(10 * pixels_per_mm), int(23 * pixels_per_mm), int(image.height - 10 * pixels_per_mm))
            strip = image.crop(box)
            ink = sum(value < 150 for value in strip.get_flattened_data())
            digest = hashlib.sha256(strip.tobytes()).hexdigest()
            assert ink > 1000, (label, index + 1, "missing painted form fields", ink)
            if first_strip_hash is None:
                first_strip_hash = digest
            assert digest == first_strip_hash, (label, index + 1, "sealing fields differ between physical pages")
            page_checks.append({"page": index + 1, "widthMm": round(width_mm, 3), "heightMm": round(height_mm, 3), "fieldLabels": label_counts, "paintedFieldPixels": ink, "fieldStripSha256": digest})
        checks.append({"paper": label, "pages": page_checks})
    print(json.dumps({"passed": True, "checks": checks}, ensure_ascii=False))


if __name__ == "__main__":
    main()
