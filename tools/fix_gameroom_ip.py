# 遊戲室背景：把有版權疑慮的圖案換成原創的像素小圖（鯨魚、海、星星、貝殼…）
import sys
from PIL import Image, ImageDraw

SRC, OUT = sys.argv[1], sys.argv[2]
im = Image.open(SRC).convert('RGB')
d = ImageDraw.Draw(im)


def sprite(pattern, pal, cx, cy, px=4):
    h = len(pattern); w = max(len(r) for r in pattern)
    x0 = round(cx - w * px / 2); y0 = round(cy - h * px / 2)
    for j, row in enumerate(pattern):
        for i, ch in enumerate(row):
            if ch in pal:
                d.rectangle([x0 + i * px, y0 + j * px, x0 + (i + 1) * px - 1, y0 + (j + 1) * px - 1], fill=pal[ch])


def panel(box, fill, border=(36, 24, 44), bw=3, inner=None):
    d.rectangle(box, fill=border)
    x0, y0, x1, y1 = box
    d.rectangle([x0 + bw, y0 + bw, x1 - bw, y1 - bw], fill=fill)
    if inner:
        d.rectangle([x0 + bw, y0 + bw, x1 - bw, y0 + bw + 3], fill=inner)


WHALE = [
    '.....s.s.......',
    '......s........',
    '...bbbbbb......',
    '..bbbbbbbb...bb',
    '.bbebbbbbbb.bb.',
    '.bbbbbbbbbbbbb.',
    '.bwwwwwwwbbb...',
    '..wwwwwwww.....',
]
STAR = ['....y....', '....y....', '...yyy...', 'yyyyyyyyy', '.yyyyyyy.', '..yyyyy..', '..yy.yy..', '.yy...yy.', '.y.....y.']
FISH = ['...ooo.....', '..ooooo..o.', '.oeoooooooo', 'ooooooooooo', '.ooooooo.o.', '..ooooo....', '...ooo.....']
SHELL = ['...ppp...', '..ppppp..', '.pPpPpPp.', '.pPpPpPp.', 'pPpPpPpPp', '.ppppppp.', '..ppppp..', '...ppp...']
ANCHOR = ['....a....', '...a.a...', '....a....', '..aaaaa..', '....a....', '....a....', 'a...a...a', 'aa..a..aa', '.aa.a.aa.', '..aaaaa..']
SPARK = ['.x.', 'xxx', '.x.']

# 1. 街機螢幕：外星人 → 霓虹小鯨魚
d.rounded_rectangle([143, 229, 227, 286], radius=6, fill=(32, 14, 52))
sprite(WHALE, {'b': (120, 230, 255), 'w': (230, 250, 255), 'e': (32, 14, 52), 's': (255, 140, 220)}, 186, 260, 4)
for (x, y) in [(156, 240), (214, 242), (160, 278), (216, 276)]:
    sprite(SPARK, {'x': (250, 235, 255)}, x, y, 3)

# 2. 電視：平台遊戲畫面 → 海上日出、鯨魚噴水
x0, y0, x1, y1 = 620, 195, 792, 282
for y in range(y0, y1 + 1):
    t = (y - y0) / (y1 - y0)
    if t < 0.58:
        c = (int(110 + 90 * t), int(190 + 30 * t), 255)
    else:
        c = (40, 120, 200) if (y // 4) % 3 else (70, 160, 225)
    d.line([(x0, y), (x1, y)], fill=c)
d.rectangle([x0 + 18, y0 + 14, x0 + 34, y0 + 30], fill=(255, 214, 90))  # 太陽
for cx, cy in [(705, 215), (752, 208)]:  # 雲
    d.rectangle([cx - 18, cy - 4, cx + 18, cy + 4], fill=(250, 250, 255))
    d.rectangle([cx - 10, cy - 10, cx + 8, cy - 4], fill=(250, 250, 255))
sprite(WHALE, {'b': (52, 84, 150), 'w': (200, 225, 245), 'e': (20, 30, 60), 's': (220, 245, 255)}, 700, 262, 4)
for i in range(3):  # 心（血量）換成小星星
    sprite(STAR, {'y': (255, 220, 90)}, 632 + i * 16, 207, 1.6)

# 3. 收藏櫃：四個盒子封面
panel([920, 168, 974, 221], (47, 111, 143))
sprite(FISH, {'o': (255, 160, 70), 'e': (40, 30, 30)}, 947, 195, 4)
panel([981, 171, 1036, 224], (36, 54, 94))
sprite(STAR, {'y': (255, 214, 90)}, 1008, 198, 4)
panel([981, 241, 1036, 294], (199, 91, 74))
sprite(SHELL, {'p': (255, 226, 214), 'P': (240, 170, 160)}, 1008, 268, 4)
panel([914, 298, 967, 351], (91, 61, 122))
sprite(ANCHOR, {'a': (240, 230, 255)}, 940, 325, 4)

# 4. 問號磚、蘑菇磚 → 星星木箱、船錨木箱
face_o = im.getpixel((200, 600)); face_b = im.getpixel((205, 690))
d.rectangle([194, 588, 244, 634], fill=face_o)
sprite(STAR, {'y': (255, 246, 220)}, 219, 611, 4)
d.rectangle([200, 650, 260, 704], fill=face_b)
sprite(ANCHOR, {'a': (240, 246, 255)}, 230, 677, 4)

im.save(OUT, 'WEBP', quality=92, method=6) if OUT.endswith('.webp') else im.save(OUT)
print('ok', face_o, face_b)
