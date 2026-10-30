"""Audit actual Electron PDFs, raster all pages, then inspect contact sheets.
Synthetic books only. Requires system Poppler, pypdf and Pillow.
"""
import argparse
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image, ImageDraw
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument("pdf")
parser.add_argument("--output", required=True)
parser.add_argument("--questions", type=int, default=0)
args = parser.parse_args()
source, output = Path(args.pdf).resolve(), Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=True)
reader = PdfReader(source)
text = subprocess.check_output(["pdftotext", "-layout", str(source), "-"], encoding="utf-8")
pages = text.split("\f")
if pages and not pages[-1].strip():
    pages.pop()
assert len(pages) == len(reader.pages), "Text and PDF page counts differ"
assert all(page.strip() for page in pages), "Unexpected entirely blank PDF page"
question_ids = [int(value) for value in re.findall(r"长书稿第\s*(\d+)\s*题", text)]
if args.questions:
    assert question_ids == list(range(1, args.questions + 1)), "A question is missing, duplicated or out of order"
    assert len(re.findall(r"答案\s*[:：]", text)) == args.questions, "The answer appendix is incomplete"
box_path = output / "page-bounds.html"
subprocess.run(["pdftotext", "-bbox", str(source), str(box_path)], check=True)
root = ET.parse(box_path).getroot()
ns = {"h": "http://www.w3.org/1999/xhtml"}
overflow = []
for index, page in enumerate(root.findall(".//h:page", ns), 1):
    width, height = float(page.attrib["width"]), float(page.attrib["height"])
    for word in page.findall("h:word", ns):
        a = word.attrib
        if float(a["xMin"]) < -1 or float(a["yMin"]) < -1 or float(a["xMax"]) > width + 1 or float(a["yMax"]) > height + 1:
            overflow.append({"page": index, "word": word.text, "box": a})
assert not overflow, f"Words outside physical paper: {overflow[:6]}"
subprocess.run(["pdftoppm", "-scale-to", "290", "-png", str(source), str(output / "page")], check=True, stdout=subprocess.DEVNULL)
files = sorted(output.glob("page-*.png"))
assert len(files) == len(reader.pages), "Not every physical page was rasterized"
contacts = []
for start in range(0, len(files), 40):
    sheet = Image.new("RGB", (2000, 1640), "#e7eaee")
    draw = ImageDraw.Draw(sheet)
    for offset, file in enumerate(files[start:start + 40]):
        image = Image.open(file).convert("RGB")
        image.thumbnail((186, 292))
        x, y = (offset % 10) * 200, (offset // 10) * 410
        sheet.paste(image, (x + (200 - image.width) // 2, y + 25))
        draw.text((x + 85, y + 5), str(start + offset + 1), fill="#17202c")
    path = output / f"contact-{start // 40 + 1:02d}.jpg"
    sheet.save(path, quality=88)
    contacts.append(str(path))
report = {"passed": True, "pdf": str(source), "pages": len(reader.pages), "questions": len(question_ids), "rasterized": len(files), "outOfPaperWords": overflow, "contacts": contacts, "sizesPt": sorted(set((round(float(page.mediabox.width), 2), round(float(page.mediabox.height), 2)) for page in reader.pages))}
(output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False))
