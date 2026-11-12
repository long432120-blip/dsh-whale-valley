"""V0.16：去掉綠幕（GPT 生成的 UI 圖）。用「跟背景綠色的距離」判斷，不會把藤蔓葉子（偏黃的綠）也挖掉。
用法：python3 tools/key_green.py 輸入.png 輸出.png [--width 480] [--cells 4 --cell 96]
"""
import argparse
import numpy as np
from PIL import Image

def key(path):
    rgb = np.array(Image.open(path).convert('RGB')).astype(np.int32)
    h, w, _ = rgb.shape
    corners = np.concatenate([rgb[:8, :8].reshape(-1, 3), rgb[:8, -8:].reshape(-1, 3), rgb[-8:, :8].reshape(-1, 3), rgb[-8:, -8:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    d = np.sqrt(((rgb - bg) ** 2).sum(-1))
    a = np.clip((d - 45) * 255 / 50, 0, 255)  # 距離 < 45 全透明，> 95 不透明（葉子離背景綠 > 120）
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    edge = (a > 0) & (a < 255)
    g = np.where(edge & (g > np.maximum(r, b)), np.maximum(r, b), g)  # 半透明的邊：去掉綠色溢色
    return Image.fromarray(np.stack([r, g, b, a], -1).astype(np.uint8), 'RGBA')

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--width', type=int, default=0)
ap.add_argument('--cells', type=int, default=0)
ap.add_argument('--cell', type=int, default=96)
o = ap.parse_args()
im = key(o.src)
if o.cells:
    S, n = o.cell, o.cells
    sheet = Image.new('RGBA', (S * n, S), (0, 0, 0, 0))
    for i in range(n):
        cell = im.crop((i * im.width // n, 0, (i + 1) * im.width // n, im.height))
        c = cell.crop(cell.getbbox())
        sc = min((S - 6) / c.width, (S - 6) / c.height)
        c = c.resize((round(c.width * sc), round(c.height * sc)), Image.LANCZOS)
        sheet.alpha_composite(c, (i * S + (S - c.width) // 2, (S - c.height) // 2))
    sheet.save(o.out, optimize=True)
else:
    im = im.crop(im.getbbox())
    if o.width:
        im = im.resize((o.width, round(im.height * o.width / im.width)), Image.LANCZOS)
    im.save(o.out, optimize=True)
print(o.out, Image.open(o.out).size)
