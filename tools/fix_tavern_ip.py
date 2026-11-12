# 酒館街機螢幕：外星人 → 霓虹小鯨魚
import sys
from PIL import Image, ImageDraw
SRC, OUT = sys.argv[1], sys.argv[2]
im = Image.open(SRC).convert('RGB'); d = ImageDraw.Draw(im)
WHALE = ['.....s.s.......', '......s........', '...bbbbbb......', '..bbbbbbbb...bb', '.bbebbbbbbb.bb.', '.bbbbbbbbbbbbb.', '.bwwwwwwwbbb...', '..wwwwwwww.....']
def sprite(p, pal, cx, cy, px):
    w = max(map(len, p)); h = len(p); x0 = round(cx - w * px / 2); y0 = round(cy - h * px / 2)
    for j, r in enumerate(p):
        for i, ch in enumerate(r):
            if ch in pal: d.rectangle([x0 + i * px, y0 + j * px, x0 + (i + 1) * px - 1, y0 + (j + 1) * px - 1], fill=pal[ch])
d.rounded_rectangle([831, 219, 881, 250], radius=3, fill=(30, 14, 54))
sprite(WHALE, {'b': (120, 230, 255), 'w': (230, 250, 255), 'e': (30, 14, 54), 's': (255, 140, 220)}, 856, 236, 2)
for x, y in [(836, 224), (876, 225), (838, 246), (875, 245)]:
    d.rectangle([x - 1, y, x + 1, y], fill=(245, 235, 255)); d.rectangle([x, y - 1, x, y + 1], fill=(245, 235, 255))
im.save(OUT, 'WEBP', quality=92, method=6) if OUT.endswith('.webp') else im.save(OUT)
