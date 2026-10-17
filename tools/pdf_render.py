import sys, os, fitz

outdir = r"C:\Users\gargi\navi\docs\pages"
os.makedirs(outdir, exist_ok=True)

targets = [
    ("ps", r"C:\Users\gargi\Downloads\f94a7551-3a23-455e-ab48-369fdfe7e680.pdf", 150),
]
which = sys.argv[1] if len(sys.argv) > 1 else None
for key, path, zoom in targets:
    if which and which != key:
        continue
    d = fitz.open(path)
    for i, page in enumerate(d):
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom / 72, zoom / 72))
        out = os.path.join(outdir, "%s-%02d.png" % (key, i + 1))
        pix.save(out)
        print(out, pix.width, "x", pix.height, os.path.getsize(out) // 1024, "KB")
    d.close()
