"""Audit actual LibreOffice-rendered QA files, not an HTML approximation.

Run with the bundled Python after the canonical documents/render_docx.py.
The caller must still visually inspect every page; pixel checks complement it.
"""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

from PIL import Image
from pypdf import PdfReader


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--suffix", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / "artifacts" / "qa-word-export"
    checks = []
    for paper, width, height in [("A4", 210, 297), ("A3", 420, 297), ("8K", 390, 270)]:
        source = root / f"数学试卷-{paper}.docx"
        directory = root / f"render-{paper}{args.suffix}"
        pdf = directory / f"数学试卷-{paper}.pdf"
        pages = PdfReader(pdf).pages
        pngs = sorted(directory.glob("page-*.png"), key=lambda file: int(file.stem.split("-")[-1]))
        assert len(pages) == len(pngs) > 0, (paper, "rendered page count")
        with ZipFile(source) as archive:
            document = archive.read("word/document.xml").decode("utf-8")
            equations = document.count("<m:oMath ") + document.count("<m:oMath>")
            assert equations >= 40 and "<w:tbl>" in document, (paper, "editable math and table lost")
            if paper != "A4":
                assert "word/media/seal.png" in archive.namelist()
                header = archive.read("word/header1.xml").decode("utf-8")
                assert "wp:anchor" in header and "rSeal" in header and "v:shape" not in header
        strip_hash = None
        for page, png in zip(pages, pngs):
            assert abs(float(page.mediabox.width) * 25.4 / 72 - width) < .3
            assert abs(float(page.mediabox.height) * 25.4 / 72 - height) < .3
            assert png.stat().st_mtime_ns >= source.stat().st_mtime_ns, (paper, "stale rendered page")
            image = Image.open(png).convert("L")
            assert image.width > 1000 and image.height > 1000
            if paper != "A4":
                ratio = image.width / width
                box = tuple(round(value * ratio) for value in (11, 11, 28, height - 11))
                strip = image.crop(box)
                assert sum(pixel < 160 for pixel in strip.getdata()) > 500, (paper, "empty sealing strip")
                digest = hashlib.sha256(strip.tobytes()).hexdigest()
                if strip_hash is not None:
                    assert digest == strip_hash, (paper, "seal differs on a later page")
                strip_hash = digest
        checks.append({"paper": paper, "pages": len(pages), "equations": equations, "sealHash": strip_hash,
                       "docxSha256": hashlib.sha256(source.read_bytes()).hexdigest()})
    result = {"passed": True, "verification": "Real rendered geometry, native OOXML and per-page sealing pixels; visual page review is also required", "checks": checks}
    (root / "render-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
