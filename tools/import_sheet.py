#!/usr/bin/env python3
"""
把「白底、排成格子」的角色圖（AI 生成或手繪皆可）轉成遊戲用的 sprite sheet。

用法：
  # 走路圖：4 列 × 4 欄
  python3 tools/import_sheet.py 走路圖.png packs/<角色包>/assets/whale-girl-world.png --preview 預覽.png
  # 動作表：例如 5 列 × 6 欄；--ref-height 讓第一格的身高跟走路圖一樣（走路圖轉完會印出來）
  python3 tools/import_sheet.py 動作表.png packs/<角色包>/assets/whale-girl-actions.png --grid 5x6 --mode actions --ref-height 120

原圖規則：
  - 白色（或接近白色）背景，格子之間要有空白
  - 走路圖：列由上到下為正面（下）、面向左、面向右、背面（上）；欄為站立、走路 A、走路 B、站立 2
  - 動作表：每一列是一段動作，第一格最好是普通站姿（用來對齊身高）

做的事：
  1. 依空白自動切格
  2. 從外圍把白底去掉；被頭髮、尾巴圍住的白色縫隙用「周圍顏色 + 位置」判斷後一併去掉
     （白色圍裙、頭飾、襪子這類衣服會保留）
  3. 以頭部中心與腳底（或跳躍時地上的影子）對齊每一格，避免播動畫時左右抖動
  4. 高品質縮小到 --height 像素高，邊緣做成不透明 / 全透明兩種，去掉白色光暈
  5. 輸出 sprite sheet，並印出要貼進 character.json 的設定

需要：Python 3、Pillow、numpy（pip install pillow numpy）
"""
import argparse, json, sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter


def runs(profile, gap=6):
    """找出非空白的連續區段（允許中間有少於 gap 的空隙）"""
    out, start, last = [], None, None
    for i, v in enumerate(profile):
        if v:
            if start is None: start = i
            last = i
        elif start is not None and i - last > gap:
            out.append((start, last)); start = None
    if start is not None: out.append((start, last))
    return out


def near_white(p, t):
    return p[0] >= t and p[1] >= t and p[2] >= t


def remove_outer_background(cell, t=236):
    w, h = cell.size; px = cell.load()
    seen = bytearray(w * h); q = deque()
    for x in range(w): q += [(x, 0), (x, h - 1)]
    for y in range(h): q += [(0, y), (w - 1, y)]
    while q:
        x, y = q.popleft(); i = y * w + x
        if seen[i]: continue
        seen[i] = 1
        if not near_white(px[x, y], t): continue
        px[x, y] = (0, 0, 0, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]: q.append((nx, ny))


def white_components(cell, t=240, min_size=30):
    w, h = cell.size; px = cell.load(); seen = bytearray(w * h); comps = []
    ok = lambda p: p[3] > 0 and near_white(p, t)
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if seen[i] or not ok(px[x, y]): continue
            pts = []; q = deque([(x, y)]); seen[i] = 1
            while q:
                a, b = q.popleft(); pts.append((a, b))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    na, nb = a + dx, b + dy
                    if 0 <= na < w and 0 <= nb < h and not seen[nb * w + na] and ok(px[na, nb]):
                        seen[nb * w + na] = 1; q.append((na, nb))
            if len(pts) >= min_size: comps.append(pts)
    return comps


def ring_stats(cell, pts, r0=3, r1=6):
    px = cell.load(); w, h = cell.size; ps = set(pts); ring = set()
    for (x, y) in pts[::2]:
        for dy in range(-r1, r1 + 1):
            for dx in range(-r1, r1 + 1):
                if max(abs(dx), abs(dy)) < r0: continue
                n = (x + dx, y + dy)
                if n not in ps and 0 <= n[0] < w and 0 <= n[1] < h: ring.add(n)
    c = dict(hair=0, dark=0, clear=0, light=0, skin=0, other=0)
    for n in ring:
        r, g, b, a = px[n]; lum = 0.3 * r + 0.59 * g + 0.11 * b
        if a == 0: c['clear'] += 1
        elif lum < 55: c['dark'] += 1
        elif b > r + 40 and b > g + 10 and lum < 215: c['hair'] += 1
        elif r > b + 10 and lum > 150: c['skin'] += 1
        elif lum >= 215: c['light'] += 1
        else: c['other'] += 1
    tot = max(1, len(ring))
    return {k: v / tot for k, v in c.items()}


def remove_pockets(cell):
    """被頭髮 / 尾巴圍住的白底：周圍幾乎都是頭髮或深色、沒有衣服的淺灰陰影、也不是皮膚"""
    removed = 0; px = cell.load()
    for pts in white_components(cell):
        s = ring_stats(cell, pts)
        ys = [p[1] for p in pts]; cy = (min(ys) + max(ys)) / 2
        lower = cy > 0.45 * cell.height
        if s['skin'] < 0.05 and ((s['hair'] >= 0.5 and s['light'] <= 0.06) or
                                 (lower and s['light'] <= 0.10 and s['hair'] + s['dark'] >= 0.78)):
            for p in pts: px[p] = (0, 0, 0, 0)
            removed += 1
    # 縫隙邊緣殘留的淺色抗鋸齒像素也一起清掉
    for _ in range(2):
        a = np.asarray(cell).copy(); al = a[..., 3] > 0
        rgb = a[..., :3].astype(int); lum = rgb @ [0.3, 0.59, 0.11]
        sat = rgb.max(-1) - rgb.min(-1)
        border = np.zeros_like(al)
        border[1:, :] |= ~al[:-1, :]; border[:-1, :] |= ~al[1:, :]
        border[:, 1:] |= ~al[:, :-1]; border[:, :-1] |= ~al[:, 1:]
        kill = al & border & (lum > 228) & (sat < 28)
        a[kill] = 0
        cell = Image.fromarray(a, 'RGBA'); px = cell.load()
    return cell, removed


def largest_component(mask):
    """最大的連通區塊 = 角色本體（特效符號、汗滴、地上的影子都是另外的小區塊）"""
    h, w = mask.shape; label = np.zeros((h, w), np.int32); best, best_n, cur = 0, 0, 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if label[y0, x0]: continue
        cur += 1; n = 0; q = deque([(y0, x0)]); label[y0, x0] = cur
        while q:
            y, x = q.popleft(); n += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not label[ny, nx]:
                    label[ny, nx] = cur; q.append((ny, nx))
        if n > best_n: best, best_n = cur, n
    return label == best


def anchor(cell):
    """回傳 (頭部中心 x, 腳底 y, 身高)。頭部 = 角色本體上方 30%；腳底 = 最低的不透明像素（跳起來時是地上的影子）"""
    a = np.asarray(cell)[..., 3] > 0
    body = largest_component(a)
    ys = np.nonzero(body.any(1))[0]
    top = ys.min()
    head = body[top: top + int((ys.max() - top) * 0.30)]
    hx = np.nonzero(head.any(0))[0]
    bottom = np.nonzero(a.any(1))[0].max()
    return (hx.min() + hx.max()) / 2, bottom, bottom - top + 1


def premul_resize(im, size):
    a = np.asarray(im).astype(np.float32) / 255
    pm = np.dstack([a[..., :3] * a[..., 3:4], a[..., 3:4]])
    small = np.asarray(Image.fromarray((pm * 255).astype(np.uint8), 'RGBA').resize(size, Image.LANCZOS)).astype(np.float32) / 255
    al = small[..., 3:4]
    rgb = np.where(al > 0.02, small[..., :3] / np.maximum(al, 1e-6), 0)
    return np.clip(rgb, 0, 1), al[..., 0]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--grid', default='4x4', help='列 x 欄，例如 4x4（走路圖）、5x6（動作表）')
    ap.add_argument('--mode', choices=['walk', 'actions'], default='walk', help='walk = 4 方向走路圖；actions = 動作表')
    ap.add_argument('--height', type=int, default=120, help='輸出時最高那一格的像素高度（預設 120）')
    ap.add_argument('--ref-height', type=int, help='改用「第一格的身高」決定縮放；動作表請填走路圖印出的站姿身高')
    ap.add_argument('--display', type=float, default=40, help='在地圖上要顯示幾個地圖像素高（預設 40，約 2.5 格）')
    ap.add_argument('--preview', help='額外輸出一張放在綠底上的預覽圖')
    args = ap.parse_args()

    nr, nc = (int(v) for v in args.grid.lower().split('x'))
    src = Image.open(args.src).convert('RGBA'); W, H = src.size
    arr = np.asarray(src.convert('RGB')).astype(int)
    lum = arr.mean(-1); sat = arr.max(-1) - arr.min(-1)
    ink = (lum < 215) | (sat > 40)  # JPG 的白底會有雜訊，用亮度 + 彩度判斷「有畫東西」
    cols = runs(ink.sum(0) > 2); rows = runs(ink.sum(1) > 2)
    if len(cols) != nc or len(rows) != nr:
        sys.exit(f'切格失敗：找到 {len(rows)} 列 × {len(cols)} 欄，需要 {nr} × {nc}（格子之間要留白，或用 --grid 指定）')

    pad = 12; cells = []
    for (y0, y1) in rows:
        for (x0, x1) in cols:
            box = (max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad + 1), min(H, y1 + pad + 1))
            cell = src.crop(box)
            remove_outer_background(cell)
            cell, n = remove_pockets(cell)
            cells.append(cell)

    full = [anchor(c) for c in cells]
    anchors = [(ax, ay) for ax, ay, _ in full]
    heights = []  # 腳底到最上方（含特效）的高度
    for c, (ax, ay) in zip(cells, anchors):
        ys = np.nonzero(np.asarray(c)[..., 3].any(1))[0]; heights.append(ay - ys.min() + 1)
    # 所有格子用同一個縮放比例
    f = args.ref_height / full[0][2] if args.ref_height else args.height / max(heights)
    left = max(ax - np.nonzero(np.asarray(c)[..., 3].any(0))[0].min() for c, (ax, ay) in zip(cells, anchors))
    right = max(np.nonzero(np.asarray(c)[..., 3].any(0))[0].max() - ax for c, (ax, ay) in zip(cells, anchors))
    up = max(heights)
    fw = int(np.ceil((left + right + 1) * f)) + 2; fh = int(np.ceil(up * f)) + 3
    fw += fw % 2
    foot = fh - 2  # 腳底所在的列

    sheet = np.zeros((fh * nr, fw * nc, 4), np.uint8)
    for i, (c, (ax, ay)) in enumerate(zip(cells, anchors)):
        cw, ch = c.size
        sw, sh = max(1, round(cw * f)), max(1, round(ch * f))
        rgb, al = premul_resize(c, (sw, sh))
        # 銳利化一點，補回縮小造成的模糊
        rgb8 = Image.fromarray((rgb * 255).astype(np.uint8), 'RGB').filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=2))
        rgb = np.asarray(rgb8).astype(np.float32) / 255
        solid = al > 0.5
        # 邊緣的白色光暈去掉
        lum = rgb @ np.array([0.3, 0.59, 0.11], np.float32)
        edge = solid & ~(np.roll(solid, 1, 0) & np.roll(solid, -1, 0) & np.roll(solid, 1, 1) & np.roll(solid, -1, 1))
        solid &= ~(edge & (lum > 0.9))
        tile = np.zeros((sh, sw, 4), np.uint8)
        tile[..., :3] = (rgb * 255).astype(np.uint8); tile[..., 3] = solid * 255
        ox = int(round(fw / 2 - ax * f)); oy = int(round(foot - ay * f))
        r, col = divmod(i, nc)
        dst = sheet[r * fh:(r + 1) * fh, col * fw:(col + 1) * fw]
        x0, y0 = max(0, ox), max(0, oy); x1, y1 = min(fw, ox + sw), min(fh, oy + sh)
        part = tile[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
        m = part[..., 3] > 0
        dst[y0:y1, x0:x1][m] = part[m]

    Image.fromarray(sheet, 'RGBA').save(args.out, optimize=True)
    draw_scale = round(args.display / args.height, 5)
    stand_h = int(round(full[0][2] * f))
    base = {
        'src': 'assets/' + args.out.replace('\\', '/').split('/')[-1],
        'frameWidth': fw, 'frameHeight': fh, 'footY': foot, 'drawScale': draw_scale,
    }
    if args.mode == 'walk':
        cfg = {**base, 'rows': {'down': 0, 'left': 1, 'right': 2, 'up': 3}, 'idle': 0, 'walk': [1, 0, 2, 3], 'fps': 7}
        key = 'world'
    else:
        cfg = {**base, 'clips': {f'row{r}': {'row': r, 'frames': list(range(nc)), 'fps': 6} for r in range(nr)}}
        key = 'actions'
    print(f'✓ {args.out}：每格 {fw}×{fh}，共 {nr}×{nc} 格；第一格身高 {stand_h} 像素')
    if args.mode == 'walk':
        print(f'  轉動作表時請加上 --ref-height {stand_h}，兩張圖的身高才會一致')
    print(f'貼進 character.json 的 "{key}"（動作表的 clips 請改成有意義的名字與幀序）：')
    print(json.dumps(cfg, ensure_ascii=False, indent=2))

    if args.preview:
        bg = Image.new('RGBA', (fw * nc + 10, fh * nr + 10), (143, 209, 111, 255))
        bg.alpha_composite(Image.fromarray(sheet, 'RGBA'), (5, 5))
        bg.resize((bg.width * 2, bg.height * 2), Image.NEAREST).save(args.preview)


if __name__ == '__main__':
    main()
