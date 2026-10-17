import sys, os, fitz

targets = {
    "ps": r"C:\Users\gargi\Downloads\f94a7551-3a23-455e-ab48-369fdfe7e680.pdf",
    "solution": r"C:\Users\gargi\Downloads\Pookie_commits_genesis-main solution.pdf",
}
outdir = r"C:\Users\gargi\navi\docs\extracted"
os.makedirs(outdir, exist_ok=True)
only = sys.argv[1] if len(sys.argv) > 1 else None
for key, path in targets.items():
    if only and key != only:
        continue
    if not os.path.exists(path):
        print("MISSING", key, path)
        continue
    d = fitz.open(path)
    buf = []
    for i, page in enumerate(d):
        buf.append("\n\n----- PAGE %d -----\n" % (i + 1))
        buf.append(page.get_text())
    d.close()
    text = "".join(buf)
    out = os.path.join(outdir, key + ".txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    print(key, "chars", len(text), "->", out)
