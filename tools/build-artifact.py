"""Bundle public/graphics.html and its scripts into one self-contained page.
Usage: python3 tools/build-artifact.py [out.html]"""
import pathlib, re, sys
root = pathlib.Path(__file__).resolve().parent.parent / 'public'
html = (root / 'graphics.html').read_text()
def inline(m):
    js = (root / m.group(1)).read_text().replace('</script', '<\\/script')
    return '<script>\n' + js + '\n</script>'
html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
# links back to the website don't exist inside the standalone page
html = re.sub(r'<a href="/">.*?</a> · <a href="/session-builder.html">.*?</a>\n', '', html)
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'build/graphics-studio.html')
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html)
print(out, len(html))
