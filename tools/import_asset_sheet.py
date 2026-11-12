#!/usr/bin/env python3
"""V0.10／V0.12：把 GPT 畫的素材表（純綠背景）切開，換進遊戲。

  python3 tools/import_asset_sheet.py            產生圖塊、圖集、sprites.json、寵物圖
  python3 tools/import_asset_sheet.py --labels   每張素材表輸出一張標了編號的圖（assets/source/labels/）

讀：
  packs/whale-girl-pixel/assets/source/gpt-asset-sheet.png   V0.10 的素材表（1536×1024，背景 #00FF00）
  packs/whale-girl-pixel/assets/source/sheet-*.png            V0.12 的分類素材表（魚、家具、裝備…，見 SHEETS）
  packs/whale-girl-pixel/assets/tiles.png                     舊的 16px 圖塊（沒換到的格子沿用，放大 4 倍）
  packs/whale-girl-pixel/maps/*.tmj                           找出建築、樹在地圖上排成幾格
寫：
  packs/whale-girl-pixel/assets/tiles-hd.webp                 4 倍解析度的圖塊（每格 64px，順序跟 tiles.png 一樣）
  packs/whale-girl-pixel/assets/sprites.webp                  動物、作物、物品圖示的圖集
  packs/whale-girl-pixel/sprites.json                         圖集座標＋哪個 id 用哪張圖
  packs/whale-girl-pixel/assets/pets/{jellyfish,fairy,mole}.png  寵物圖（96px，pets.json 的 scale 要配 1/6）

對照表裡的「編號」寫成 (素材表, 第幾個)；只寫數字 = V0.10 那張 gpt-asset-sheet。
換一張新的素材表：改 SHEET_* 對照表的編號（跑 --labels 看編號）。
"""
import glob
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PACK = os.path.join(ROOT, 'packs', 'whale-girl-pixel')
SRC = os.path.join(PACK, 'assets', 'source')
TS = 16
HD = 4  # 高解析倍率：每格 64px
T = TS * HD
BG = (2, 250, 2)  # 素材表背景色（跑一次看 a[5,5]）

# ───────────── 素材表上的編號 → 用途（編號由 detect() 決定，跑 --labels 看） ─────────────

# V0.12 的分類素材表：簡稱 → 檔名（assets/source/ 底下）
SHEETS = {
    'farm': 'gpt-asset-sheet.png',          # V0.10 的綜合素材表
    'pets': 'sheet-pets.png',               # 水母、小精靈、鼴鼠
    'crops': 'sheet-crops.png',             # 6 種作物 × 4 個階段（草莓、番茄、玉米、南瓜、胡蘿蔔、向日葵）
    'bldA': 'sheet-buildings-a.png',
    'bldB': 'sheet-buildings-b.png',
    'garden': 'sheet-garden.png',           # 四季樹、灌木、花叢、石頭、樹樁、柵欄
    'furniture': 'sheet-furniture.png',     # 跟 gameplay.json 的家具／地板／壁紙一一對應
    'gear': 'sheet-gear.png',               # 劍、盔甲、鎬子、釣竿、魚餌、捕捉網…
    'fish': 'sheet-fish.png',               # 21 種魚（第三排是傳說魚）
    'goods': 'sheet-goods.png',             # 料理、礦石、寶石、怪物掉落物、雜物
    'animals': 'sheet-animals.png',         # 正面的牧場動物（成年、幼崽）
    'terrain': 'sheet-terrain.png',
    'water': 'sheet-water.png',
    'monsters': 'sheet-monsters.png',       # 石頭人、史萊姆、蝙蝠、蘑菇怪
    'mine': 'sheet-mine.png',               # 礦洞的牆、地板、梯子
    'interior': 'sheet-interior.png',       # 室內家具（閣樓的窗戶、牆、出貨箱）
    'extra': 'sheet-extra.png',             # V0.13：機器 ×4、辣椒和白菜、金幣和海鮮、骷髏幽靈小惡魔
    'tavernOut': 'tavern-outside.png',      # V0.13：酒館外觀（整張是一個東西）
}
WHOLE = {'tavernOut'}  # 整張圖當一個物件（不要拆成桶子、桌子…）


def R(sheet, n):
    return (sheet, n)


# 地面圖塊：圖塊名稱 → (編號, 變形)。變形讓重複的草地不那麼像格子
SHEET_TILES = {
    'grass0': (0, None),
    'grass1': (0, 'rot180'),
    'grass2': (1, None),          # 有小花的草地
    'path0': (R('terrain', 4), None),
    'path1': (R('terrain', 4), 'flip'),
    'sand0': (8, None),                         # 新素材表的沙灘紋路太花，拼起來很亂：沿用 V0.10
    'sand1': (8, 'flip'),
    'pave0': (R('terrain', 8), None),
    'pave1': (R('terrain', 8), 'rot180'),
    'floor0': (10, None),                       # 閣樓的木地板（新素材表的木板拼起來太花：沿用 V0.10）
    'floor1': (10, 'flip'),
    'soil': (R('terrain', 12), None),
    'gh_floor': (10, None),
    'water': (R('water', 0), None),

    'floorB0': (R('furniture', 13), None),      # 藍色地板（家具）
    'floorB1': (R('furniture', 13), 'flip'),
    'floorC0': (R('furniture', 14), None),      # 格子地板
    'floorC1': (R('furniture', 14), None),
    'wall_up_mint': (R('furniture', 15), None),
    'wall_up_star': (R('furniture', 16), None),
    'wall_up': (R('interior', 1), None),
    'cave0': (R('mine', 4), None),
    'cave1': (R('mine', 4), 'rot180'),          # 兩種地板交錯會變棋盤：同一張轉 180°
    'cave_wall': (R('mine', 1), None),
    # 鐵匠舖旁的告示牌底下、田裡的路面不動；以下 V0.13 修掉「舊圖底色方塊」
    'ladder': (R('mine', 7), None),
}
LILY = R('water', 2)  # 睡蓮（只取葉子和花，疊在 water 上）
STEPPING = R('terrain', 17)      # 花園的踏腳石：只取石頭，疊在透明上（底下是草地圖層）
BIN = R('interior', 23)          # 牧場的出貨箱：木箱
CLEAR_TILES = ('mbase', 'mbase_pave')  # 機器底座：透明（機器圖由程式畫）
# 疊在地面上的單格物件（去背）
SHEET_OBJECT_TILES = {
    'bush': R('garden', 5),
    'fence': R('garden', 11),
    'rock': R('garden', 9),
}
# 建築、樹：整張圖縮放到它在地圖上佔的格子範圍，再切成一格一格
SHEET_GROUPS = {
    'house': 4,                 # 花園：鯨魚娘的家
    'barn': 5,                  # 牧場：牛棚
    'ghouse': 6,                # 牧場：溫室
    'florist': R('bldA', 4),    # 小鎮：小葵的花店
    'smithy': 12,               # 小鎮：阿綱的鐵匠鋪
    'hut': R('bldB', 9),        # 海邊：老陳的小屋
    'coop': R('bldB', 14),      # 牧場：雞舍
    'stable': 14,               # 牧場：馬廄
    'stall': 15,                # 花園：旅行商人的攤位
    'tree': 30,                 # 花園：大樹
    'win': R('interior', 3),    # 閣樓的窗戶（2×2）
    'cave': R('mine', 0),       # 小鎮的礦洞入口（2×2）：有木框和油燈的那格
    'tavern': R('tavernOut', 0),  # V0.13：小鎮的酒館（5×4）
}
# 動物（成年、幼崽）
SHEET_ANIMALS = {
    'chicken': (R('animals', 0), R('animals', 5)),
    'duck': (R('animals', 1), R('animals', 6)),
    'cow': (R('animals', 2), R('animals', 7)),
    'sheep': (R('animals', 3), R('animals', 8)),
    'pig': (R('animals', 4), R('animals', 9)),
}


def C(row, col):
    """作物素材表：第 row 排（0 草莓、1 番茄、2 玉米、3 南瓜、4 胡蘿蔔、5 向日葵），第 col 個階段（0 芽、1 葉、2 花、3 成熟）"""
    return R('crops', row * 4 + col)


# 作物：每個生長階段用哪張
SHEET_CROP_FRAMES = {
    'strawberry_0': C(0, 0), 'strawberry_1': C(0, 1), 'strawberry_3': C(0, 3),
    'tomato_0': C(1, 0), 'tomato_2': C(1, 2), 'tomato_3': C(1, 3),
    'corn_0': C(2, 0), 'corn_1': C(2, 1), 'corn_2': C(2, 2), 'corn_3': C(2, 3),
    'pumpkin_0': C(3, 0), 'pumpkin_2': C(3, 2), 'pumpkin_3': C(3, 3),
    'carrot_0': C(4, 0), 'carrot_3': C(4, 3),
    'sunflower_0': C(5, 0), 'sunflower_1': C(5, 1), 'sunflower_3': C(5, 3),
    'pepper_0': R('extra', 4), 'pepper_1': R('extra', 5), 'pepper_3': R('extra', 6),
    'cabbage_0': R('extra', 7), 'cabbage_1': R('extra', 8), 'cabbage_3': R('extra', 9),
}
# 物品圖示：物品 id → 編號（沒列的物品繼續用 emoji）
SHEET_ITEMS = {
    'forage_driftwood': 60, 'ore_iron': 61, 'ore_copper': 63, 'bar_copper': 64, 'bar_gold': 65, 'gem_quartz': 66,
    'milk': 67, 'milk_large': 67, 'food_cheese': 68, 'egg': 69, 'egg_large': 69, 'egg_duck': 69,
    'wool': 70, 'wool_fine': 70, 'food_mayo': 71, 'food_pickle': 72,
    'pet_food': 79, 'seed_carrot': 80, 'seed_strawberry': 80, 'seed_pepper': 80, 'seed_tomato': 80,
    'seed_pumpkin': 80, 'seed_cabbage': 80, 'seed_corn': 80, 'seed_sunflower': 80,
    'bait_ball': 87, 'food_smoked_fish': 89,
    'crop_strawberry': 96, 'crop_tomato': 97, 'crop_corn': 98, 'crop_pumpkin': 99, 'crop_carrot': 100, 'crop_sunflower': 101,
    'forage_flower': 102, 'deco_flower': 102, 'forage_berry': 105, 'food_jam': 107,
    # V0.12 家具（順序跟素材表一樣）
    **{k: R('furniture', i) for i, k in enumerate([
        'furn_chair', 'furn_sofa', 'furn_plant', 'furn_teddy', 'furn_books', 'furn_lamp',
        'furn_aquarium', 'furn_trophy', 'furn_sakura', 'furn_scarecrow', 'furn_xmas', 'deco_stone',
        'plot_kit', 'floor_blue', 'floor_check', 'wall_mint', 'wall_star'])},
    # V0.12 裝備、工具
    **{k: R('gear', i) for i, k in enumerate([
        'sword_wood', 'sword_copper', 'sword_iron', 'sword_crystal', 'armor_leather', 'armor_iron', 'armor_crystal',
        'pickaxe_basic', 'pickaxe_copper', 'pickaxe_iron', 'pickaxe_gold', 'rod_bamboo', 'rod_fiberglass', 'rod_iridium',
        'bait_worm', 'bait_magic', 'net_basic', 'net_silk', 'tool_sprinkler', 'hay', 'feather', 'truffle', 'pet_treat'])},
    # V0.12 料理、礦石、掉落物、雜物
    **{k: R('goods', i) for i, k in enumerate([
        'food_sushi', 'food_salad', 'food_soup', 'food_pie', 'food_kimchi', 'food_ketchup',
        'food_omelette', 'ore_gold', 'bar_iron', 'gem_amethyst', 'gem_diamond', 'gem_ruby',
        'drop_slime', 'drop_wing', 'drop_bone', 'drop_ecto', 'item_blue_shell', 'cloth',
        'forage_mushroom', 'forage_seaglass', 'junk_boot', 'junk_can'])},
    # V0.12 魚（素材表第 1、2 排一般魚，第 3 排傳說魚）
    'fish_icefish': R('fish', 0), 'fish_bass': R('fish', 1), 'fish_carp': R('fish', 3), 'fish_mackerel': R('fish', 4),
    'fish_sunfish': R('fish', 5), 'fish_trout': R('fish', 6), 'fish_goldfish': R('fish', 8), 'fish_tropical': R('fish', 9),
    'fish_salmon': R('fish', 10), 'fish_puffer': R('fish', 11), 'fish_eel': R('fish', 12), 'fish_squid': R('fish', 13),
    'fish_koi_king': R('fish', 14), 'fish_golden_trout': R('fish', 15), 'fish_shark': R('fish', 18), 'fish_oarfish': R('fish', 20),
    'fish_jellyfish': R('pets', 0),
    # V0.14 家具目錄：室內家具表、庭園表
    **{k: R('interior', i) for k, i in [
        ('furn_fireplace', 7), ('furn_bed_single', 8), ('furn_bed_double', 9),
        ('furn_rug_pink', 11), ('furn_rug_blue', 12), ('furn_rug_green', 13), ('furn_rug_red', 14),
        ('furn_bookshelf_tall', 15), ('furn_table_long', 16), ('furn_table_round', 17), ('furn_desk', 18),
        ('furn_armchair', 19), ('furn_sofa_blue', 20), ('furn_stool', 22), ('furn_chest', 23), ('furn_nightstand', 24),
        ('furn_dresser', 25), ('furn_wardrobe', 26), ('furn_stove', 28), ('furn_pantry', 30), ('furn_palm', 31),
        ('furn_sunflower_vase', 32), ('furn_floor_lamp', 33), ('furn_clock', 34), ('furn_flowerpot', 39),
        ('furn_lucky_cat', 41), ('furn_snowman', 42), ('furn_fishbowl', 43)]},
    **{k: R('garden', i) for k, i in [
        ('furn_sakura_tree', 0), ('furn_apple_tree', 4), ('furn_rose_bush', 6), ('furn_stump', 10),
        ('furn_stone_wall', 12), ('furn_hedge', 13)]},
    # V0.13 補畫的
    'coin': R('extra', 10), 'fish_shrimp': R('extra', 11), 'fish_crab': R('extra', 12), 'fish_lobster': R('extra', 13),
    'fish_octopus': R('extra', 14), 'crop_pepper': R('extra', 15), 'crop_cabbage': R('extra', 16),
}
# 佔好幾格的家具：圖集裡存大一點，畫在地圖上才不會糊
BIG_ITEMS = {k: 128 for k in ('furn_fireplace', 'furn_bed_double', 'furn_rug_pink', 'furn_rug_blue', 'furn_rug_green', 'furn_rug_red',
                              'furn_sakura_tree', 'furn_apple_tree')}
BIG_ITEMS.update({k: 96 for k in ('furn_bed_single', 'furn_table_long', 'furn_desk', 'furn_sofa_blue', 'furn_pantry', 'furn_hedge',
                                  'furn_stone_wall', 'furn_sofa', 'furn_aquarium')})
# 礦洞怪物：怪物名稱（gameplay.json mine.zones[].monsters[].name）→ (編號, 色相旋轉角度)
SHEET_MONSTERS = {
    '史萊姆': (R('monsters', 1), 260),       # 素材表的史萊姆是藍的：轉成綠的
    '藍史萊姆': (R('monsters', 1), 0),
    '火焰史萊姆': (R('monsters', 1), 160),   # 轉成紅的
    '蝙蝠': (R('monsters', 2), 0),
    '石頭人': (R('monsters', 0), 0),
    '蘑菇怪': (R('monsters', 3), 0),
    '骷髏': (R('extra', 17), 0),
    '幽靈': (R('extra', 18), 0),
    '小惡魔': (R('extra', 19), 0),
}
# 其他單張圖：圖集 key → 編號
SHEET_OBJECTS = {
    'mine_rock': R('garden', 9),       # 礦洞裡可以敲的石頭
    'mine_ladder': R('mine', 7),       # 往下一層的梯子
    # V0.13：機器（地圖上的機器底座圖塊改成透明，機器本身用這些圖畫）
    'machine_preserves': R('extra', 0),
    'machine_smoker': R('extra', 1),
    'machine_artisan': R('extra', 2),
    'machine_furnace': R('extra', 3),
}
# 寵物：寫成 assets/pets/<名稱>.png（96px）
SHEET_PETS = {
    'jellyfish': R('pets', 0),
    'fairy': R('pets', 1),
    'mole': R('pets', 2),
}
# 作物的生長階段 → 圖（索引對應 gameplay.json 的 stages）。None = 只畫田地（剛播種）；'emoji' = 這個階段用 emoji
CROP_STAGES = {
    'carrot': [None, 'carrot_0', 'carrot_3'],
    'strawberry': [None, 'strawberry_0', 'strawberry_1', 'strawberry_3'],
    'tomato': [None, 'tomato_0', 'tomato_2', 'tomato_3'],
    'pumpkin': [None, 'pumpkin_0', 'pumpkin_2', 'pumpkin_3'],
    'pepper': [None, 'pepper_0', 'pepper_1', 'pepper_3'],
    'cabbage': [None, 'cabbage_0', 'cabbage_1', 'cabbage_3'],
    'corn': [None, 'corn_0', 'corn_1', 'corn_2', 'corn_3'],
    'sunflower': [None, 'sunflower_0', 'sunflower_1', 'sunflower_3'],
}

# 建築家族在圖塊集裡的名稱開頭
FAMILY = {
    'house': re.compile(r'^(roof_|hwall_|hdoor_|hwin)'),
    'stall': re.compile(r'^stall_'),
    'tree': re.compile(r'^(tree_|trunk_)'),
    'win': re.compile(r'^win_'),
    'cave': re.compile(r'^cave_[0-3]$'),
    'tavern': re.compile(r'^tavern_'),
    **{k: re.compile('^' + k + '_') for k in ('coop', 'barn', 'ghouse', 'florist', 'smithy', 'hut', 'stable')},
}


def detect(img):
    """素材表上的每個物件 → 外框（依由上而下、由左而右排序，編號固定）"""
    a = np.asarray(img.convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    green = (g > 180) & (r < 120) & (b < 120)
    mask = ndimage.binary_opening(~green, iterations=1)
    lab, _ = ndimage.label(ndimage.binary_dilation(mask, iterations=3))
    boxes = []
    for sl in ndimage.find_objects(lab):
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        if (x1 - x0) * (y1 - y0) >= 300:
            boxes.append((x0, y0, x1, y1))
    boxes.sort(key=lambda bx: (bx[1] // 40, bx[0]))
    return boxes


def detect_parts(img, keep=0.2, merge=60):
    """V0.12 的分類素材表：每個連通塊是一個物件；小碎片（閃光、泡泡）併到最近的物件裡。
    依「列」排序（中心 y 差不到半個物件高就算同一列），列內由左而右。"""
    a = np.asarray(img.convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    solid = ndimage.binary_opening(~((g > 180) & (r < 120) & (b < 120)), iterations=1)
    lab, _ = ndimage.label(solid)
    bx = []
    for sl in ndimage.find_objects(lab):
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        if (x1 - x0) * (y1 - y0) >= 40:
            bx.append([x0, y0, x1, y1])
    area = lambda q: (q[2] - q[0]) * (q[3] - q[1])
    ref = sorted(area(q) for q in bx)[len(bx) * 3 // 4]
    big = [q for q in bx if area(q) >= keep * ref]
    small = [q for q in bx if area(q) < keep * ref]

    def gap(p, q):
        return max(max(0, max(p[0], q[0]) - min(p[2], q[2])), max(0, max(p[1], q[1]) - min(p[3], q[3])))

    for q in small:
        near = min(big, key=lambda t: gap(q, t))
        if gap(q, near) <= merge:
            near[0], near[1], near[2], near[3] = min(near[0], q[0]), min(near[1], q[1]), max(near[2], q[2]), max(near[3], q[3])
    return [tuple(q) for q in big]


def split_tall(img, boxes, k=1.5):
    """上下黏在一起的兩個物件（家具表的泰迪熊＋稻草人）：從中間最空的那一列切開"""
    a = np.asarray(img.convert('RGB')).astype(int)
    solid = ~((a[..., 1] > 180) & (a[..., 0] < 120) & (a[..., 2] < 120))
    med = sorted(q[3] - q[1] for q in boxes)[len(boxes) // 2]
    out, todo = [], list(boxes)
    while todo:
        x0, y0, x1, y1 = todo.pop()
        if y1 - y0 <= k * med:
            out.append((x0, y0, x1, y1))
            continue
        prof = solid[y0:y1, x0:x1].sum(1)
        lo, hi = int((y1 - y0) * 0.25), int((y1 - y0) * 0.75)
        cut = y0 + lo + int(np.argmin(prof[lo:hi]))
        for t0, t1 in ((y0, cut), (cut, y1)):
            sub = solid[t0:t1, x0:x1]
            ys, xs = np.where(sub.any(1))[0], np.where(sub.any(0))[0]
            todo.append((x0 + xs[0], t0 + ys[0], x0 + xs[-1] + 1, t0 + ys[-1] + 1))
    return out


def rows_order(boxes):
    boxes = sorted(boxes, key=lambda q: (q[1] + q[3]) / 2)
    rows = []
    for q in boxes:
        cy = (q[1] + q[3]) / 2
        if rows and abs(cy - rows[-1][0]) < (q[3] - q[1]) * 0.5:
            rows[-1][1].append(q)
        else:
            rows.append([cy, [q]])
    return [q for _, rb in rows for q in sorted(rb, key=lambda t: t[0])]


class Sheets:
    """素材表快取：ref 是數字（V0.10 那張）或 (簡稱, 編號)"""

    def __init__(self):
        self.cache = {}

    def load(self, name):
        if name not in self.cache:
            img = Image.open(os.path.join(SRC, SHEETS[name]))
            if name == 'farm':
                boxes = detect(img)
            elif name in WHOLE:
                a = np.asarray(img.convert('RGB')).astype(int)
                solid = ~((a[..., 1] > 180) & (a[..., 0] < 120) & (a[..., 2] < 120))
                ys, xs = np.where(ndimage.binary_opening(solid, iterations=2))
                boxes = [(xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)]
            else:
                boxes = detect_parts(img)
                if name == 'furniture':
                    boxes = split_tall(img, boxes)
                if name == 'pets':  # 只要三隻本體，旁邊的閃光、泡泡不要
                    boxes = sorted(sorted(boxes, key=lambda q: -(q[2] - q[0]) * (q[3] - q[1]))[:3], key=lambda q: q[0])
                boxes = rows_order(boxes)
            self.cache[name] = (img, boxes)
        return self.cache[name]

    def get(self, ref):
        name, n = ref if isinstance(ref, tuple) else ('farm', ref)
        img, boxes = self.load(name)
        if n >= len(boxes):
            sys.exit(f'✗ {SHEETS[name]} 只切出 {len(boxes)} 個物件，沒有第 {n} 個（跑 --labels 看編號）')
        return img, boxes[n]

    def sprite(self, ref):
        img, box = self.get(ref)
        return keyed(img, box)


def hue_rotate(im, deg):
    if not deg:
        return im
    a = im.split()[-1]
    hsv = np.asarray(im.convert('RGB').convert('HSV')).astype(int)
    hsv[..., 0] = (hsv[..., 0] + round(deg / 360 * 255)) % 256
    out = Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB')
    out.putalpha(a)
    return out


def keyed(img, box, pad=0):
    """去掉綠背景（含邊緣的綠色溢色），回傳 RGBA，裁到不透明範圍"""
    x0, y0, x1, y1 = box
    crop = img.convert('RGB').crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad))
    a = np.asarray(crop).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # 跟背景的純綠（#00FF00 附近）差多遠：植物的綠（深、偏黃）距離很遠，不會被去掉
    dist = np.sqrt((r - BG[0]) ** 2 + (g - BG[1]) ** 2 + (b - BG[2]) ** 2)
    alpha = np.clip((dist - 60) / 70.0, 0, 1)
    # 去溢色：半透明邊緣的 g 壓到不超過 max(r, b) 太多
    edge = alpha < 1
    g2 = np.where(edge, np.minimum(g, np.maximum(r, b) + 30), g)
    out = np.dstack([r, g2, b, alpha * 255]).clip(0, 255).astype(np.uint8)
    im = Image.fromarray(out, 'RGBA')
    bbox = im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    return im.crop(bbox) if bbox else im


def ground_tile(img, box, tf):
    """地面圖塊：裁掉 GPT 畫的外框，取中間，縮成 64×64"""
    x0, y0, x1, y1 = box
    inset = int(min(x1 - x0, y1 - y0) * 0.09)
    s = min(x1 - x0, y1 - y0) - inset * 2
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    t = img.convert('RGB').crop((cx - s // 2, cy - s // 2, cx - s // 2 + s, cy - s // 2 + s)).resize((T, T), Image.LANCZOS)
    t = seamless(t)
    if tf == 'flip':
        t = t.transpose(Image.FLIP_LEFT_RIGHT)
    elif tf == 'rot180':
        t = t.transpose(Image.ROTATE_180)
    return t.convert('RGBA')


def seamless(tile):
    """讓圖塊可以無縫拼接：跟「平移半格」的自己交叉淡化（中間用原圖、邊緣用平移後的圖）。
    GPT 畫的圖塊四邊常有一圈框線，拼起來會看到格線；這樣處理之後格線就不見了。"""
    a = np.asarray(tile).astype(float)
    n = a.shape[0]
    rolled = np.roll(np.roll(a, n // 2, 0), n // 2, 1)
    u = np.linspace(0, 1, n)
    win = np.sin(np.pi * u) ** 1.5           # 中間 1、邊緣 0
    w = np.minimum.outer(win, win)[..., None]
    return Image.fromarray((a * w + rolled * (1 - w)).clip(0, 255).astype(np.uint8), 'RGB')


def fit(sprite, w, h, align='bottom'):
    """等比縮放放進 w×h（置中、貼底），透明補邊"""
    sw, sh = sprite.size
    k = min(w / sw, h / sh)
    nw, nh = max(1, round(sw * k)), max(1, round(sh * k))
    s = sprite.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    y = h - nh if align == 'bottom' else (h - nh) // 2
    canvas.alpha_composite(s, ((w - nw) // 2, y))
    return canvas


def main():
    sh = Sheets()
    if '--labels' in sys.argv:
        os.makedirs(os.path.join(SRC, 'labels'), exist_ok=True)
        for name, fn in SHEETS.items():
            img, boxes = sh.load(name)
            lab = img.convert('RGB')
            d = ImageDraw.Draw(lab)
            for i, (x0, y0, x1, y1) in enumerate(boxes):
                d.rectangle([x0, y0, x1, y1], outline=(255, 0, 255), width=2)
                d.rectangle([x0, y0, x0 + 26, y0 + 14], fill=(255, 255, 255))
                d.text((x0 + 2, y0 + 2), str(i), fill=(0, 0, 0))
            out = os.path.join(SRC, 'labels', fn.replace('.png', '-labels.png'))
            lab.save(out)
            print(f'{name:10s} {len(boxes):3d} 個 → {out}')
        return

    tsj = json.load(open(os.path.join(PACK, 'maps', 'tiles.tsj'), encoding='utf-8'))
    names = {x['id']: (x.get('type') or x.get('class')) for x in tsj['tiles']}
    ids = {v: k for k, v in names.items()}
    cols = tsj['columns']
    old = Image.open(os.path.join(PACK, 'assets', 'tiles.png')).convert('RGBA')
    hd = old.resize((old.width * HD, old.height * HD), Image.NEAREST)

    def put(name, tile):
        i = ids[name]
        x, y = (i % cols) * T, (i // cols) * T
        hd.paste(Image.new('RGBA', (T, T), (0, 0, 0, 0)), (x, y))
        hd.alpha_composite(tile, (x, y))

    def get(name):
        i = ids[name]
        return hd.crop(((i % cols) * T, (i // cols) * T, (i % cols + 1) * T, (i // cols + 1) * T))

    # 1. 地面
    for name, (ref, tf) in SHEET_TILES.items():
        img, box = sh.get(ref)
        put(name, ground_tile(img, box, tf))

    # 2. 水邊：用舊圖塊「哪些像素是水」當遮罩，新的水＋新的草地／沙灘合成，交界畫一圈岸邊
    old_water = np.asarray(old.crop(((ids['water'] % cols) * TS, (ids['water'] // cols) * TS,
                                     (ids['water'] % cols + 1) * TS, (ids['water'] // cols + 1) * TS)).convert('RGB')).reshape(-1, 3).mean(0)
    for prefix, land in (('w_', 'grass0'), ('ws_', 'sand0')):
        for suf in ('tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'):
            name = prefix + suf
            i = ids[name]
            o = np.asarray(old.crop(((i % cols) * TS, (i // cols) * TS, (i % cols + 1) * TS, (i // cols + 1) * TS)).convert('RGB')).astype(float)
            is_water = (np.abs(o - old_water).sum(-1) < 90) | ((o[..., 2] > o[..., 0] + 40) & (o[..., 2] > o[..., 1]))
            m = Image.fromarray((is_water * 255).astype(np.uint8)).resize((T, T), Image.BILINEAR)
            m = np.asarray(m) > 127
            water = np.asarray(get('water'))
            ground = np.asarray(get(land))
            out = np.where(m[..., None], water, ground).copy()
            # 岸：陸地那一側的 3px 畫成泥土色，水那一側 2px 淡一點（浪花）
            land_m = ~m
            shore = land_m & ndimage.binary_dilation(m, iterations=3)
            foam = m & ndimage.binary_dilation(land_m, iterations=2)
            out[shore] = (out[shore] * 0.35 + np.array([150, 98, 52, 255]) * 0.65).astype(np.uint8)
            out[foam] = (out[foam] * 0.6 + np.array([225, 240, 255, 255]) * 0.4).astype(np.uint8)
            out[..., 3] = 255
            put(name, Image.fromarray(out, 'RGBA'))

    # 2b. 睡蓮：只取素材表上「不是水」的像素（葉子、花）疊在我們的水上，水色才會一致。
    # 不做無縫處理（會把格子邊上的花接到另一邊，變成切一半的碎片）；碰到格子邊的碎塊也丟掉
    img, box = sh.get(LILY)
    cell = np.asarray(img.convert('RGBA').crop(box).resize((T, T), Image.LANCZOS)).astype(int)
    not_water = ~((cell[..., 2] > cell[..., 0] + 40) & (cell[..., 2] > cell[..., 1] + 10))
    not_water = ndimage.binary_opening(not_water, iterations=1)
    lab, n = ndimage.label(not_water)
    for k in range(1, n + 1):
        comp = lab == k
        ys, xs = np.where(comp)
        if comp.sum() < 40 or ys.min() == 0 or xs.min() == 0 or ys.max() == T - 1 or xs.max() == T - 1:
            not_water[comp] = False  # 素材格的外框、太小的碎塊
    layer = np.zeros((T, T, 4), np.uint8)
    layer[not_water] = cell[not_water].astype(np.uint8)
    layer[..., 3] = np.where(not_water, 255, 0)
    # 縮成 85% 放在格子中間：葉子不會碰到格子邊，拼起來不會被切一半
    k = int(T * 0.85)
    small = Image.fromarray(layer, 'RGBA').resize((k, k), Image.LANCZOS)
    lily_img = Image.fromarray(np.asarray(get('water')).astype(np.uint8), 'RGBA')
    lily_img.alpha_composite(small, ((T - k) // 2, (T - k) // 2))
    lily = np.asarray(lily_img).astype(int)
    put('lily', Image.fromarray(lily.astype(np.uint8), 'RGBA'))

    # 2c. V0.13：踏腳石、出貨箱、機器底座
    img, box = sh.get(STEPPING)
    st = np.asarray(ground_tile(img, box, None)).astype(int)
    is_grass = (st[..., 1] > st[..., 0] + 15) & (st[..., 1] > st[..., 2] + 15)
    keep = ndimage.binary_opening(~is_grass, iterations=2)
    st[..., 3] = np.where(keep, 255, 0)
    put('stone', Image.fromarray(st.astype(np.uint8), 'RGBA'))
    put('bin', fit(sh.sprite(BIN), T, T))
    for name in CLEAR_TILES:
        put(name, Image.new('RGBA', (T, T), (0, 0, 0, 0)))

    # 3. 單格物件（去背，貼底）。灌木、柵欄的舊圖塊是不透明的，有些地方底下沒有地面層 → 墊草地
    for name, ref in SHEET_OBJECT_TILES.items():
        art = fit(sh.sprite(ref), T, T)
        if name in ('bush', 'fence'):
            base = get('grass0').copy()
            base.alpha_composite(art)
            art = base
        put(name, art)

    # 4. 建築、樹、窗戶：照地圖上的排法切
    groups = {}
    for p in sorted(glob.glob(os.path.join(PACK, 'maps', '*.tmj'))):
        m = json.load(open(p, encoding='utf-8'))
        W = m['width']
        fg = m['tilesets'][0]['firstgid']
        for fam, rx in FAMILY.items():
            cells = {}
            for L in m['layers']:
                if L['type'] != 'tilelayer':
                    continue
                for k, gid in enumerate(L['data']):
                    if gid and rx.match(names.get(gid - fg, '')):
                        cells[(k % W, k // W)] = (names[gid - fg], L['name'])
            if cells and fam not in groups:
                xs = [c[0] for c in cells]
                ys = [c[1] for c in cells]
                groups[fam] = (min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1, cells)
    for fam, ref in SHEET_GROUPS.items():
        if fam not in groups:
            print(f'⚠ 地圖上找不到 {fam}，略過')
            continue
        gx, gy, gw, gh, cells = groups[fam]
        art = fit(sh.sprite(ref), gw * T, gh * T)
        for (cx, cy), (name, layer) in cells.items():
            piece = art.crop(((cx - gx) * T, (cy - gy) * T, (cx - gx + 1) * T, (cy - gy + 1) * T))
            if layer == 'ground':
                # 畫在地面層的建築（花園的家）：底下沒有別的圖層，透明的地方墊草地
                base = get('grass0').copy()
                base.alpha_composite(piece)
                piece = base
            put(name, piece)

    hd.save(os.path.join(PACK, 'assets', 'tiles-hd.webp'), 'WEBP', lossless=True, method=6)  # 有損壓縮會在格子邊緣滲色（拼起來看得到格線）

    # 5. 動物、作物、物品、怪物：圖集
    frames = {}
    sprites = []
    keys_of = {}

    def add(key, ref, size, deg=0):
        sprites.append((key, fit(hue_rotate(sh.sprite(ref), deg), size, size)))

    for a, (adult, baby) in SHEET_ANIMALS.items():
        add(f'animal:{a}', adult, 96)
        add(f'animal:{a}:baby', baby, 96)
    for k, ref in SHEET_CROP_FRAMES.items():
        add(f'crop:{k}', ref, 64)
    for item, ref in SHEET_ITEMS.items():
        if ref in keys_of:
            continue
        keys_of[ref] = f'item:{item}'
        add(f'item:{item}', ref, BIG_ITEMS.get(item, 64))
    for name, (ref, deg) in SHEET_MONSTERS.items():
        add(f'monster:{name}', ref, 96, deg)
    for k, ref in SHEET_OBJECTS.items():
        add(f'obj:{k}', ref, 64)
    x = y = rowh = 0
    W = 1024
    for key, im in sprites:
        if x + im.width > W:
            x, y, rowh = 0, y + rowh + 6, 0
        frames[key] = {'x': x, 'y': y, 'w': im.width, 'h': im.height}
        x += im.width + 6
        rowh = max(rowh, im.height)
    atlas = Image.new('RGBA', (W, y + rowh), (0, 0, 0, 0))
    for key, im in sprites:
        f = frames[key]
        atlas.alpha_composite(im, (f['x'], f['y']))
    atlas.save(os.path.join(PACK, 'assets', 'sprites.webp'), 'WEBP', quality=92, method=6)

    # 6. 寵物（pets.json 的 sprite.scale 配 1/6：96px 畫成 16px 高）
    for name, ref in SHEET_PETS.items():
        fit(sh.sprite(ref), 96, 96).save(os.path.join(PACK, 'assets', 'pets', f'{name}.png'), optimize=True)

    items = {item: keys_of[ref] for item, ref in SHEET_ITEMS.items()}
    out = {
        'version': 1,
        '_note': '由 tools/import_asset_sheet.py 產生，不要手改；要換圖請改那個檔案的對照表再跑一次',
        'tilesHd': {'image': 'assets/tiles-hd.webp', 'scale': HD},
        'atlas': 'assets/sprites.webp',
        'frames': frames,
        'items': items,
        'animals': {a: {'adult': f'animal:{a}', 'baby': f'animal:{a}:baby'} for a in SHEET_ANIMALS},
        'crops': {c: [None if s is None else 'emoji' if s == 'emoji' else f'crop:{s}' for s in st] for c, st in CROP_STAGES.items()},
        'monsters': {name: f'monster:{name}' for name in SHEET_MONSTERS},
        'objects': {k: f'obj:{k}' for k in SHEET_OBJECTS},
    }
    with open(os.path.join(PACK, 'sprites.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'✓ tiles-hd.webp {hd.size}、sprites.webp {atlas.size}（{len(frames)} 張）、sprites.json、寵物 {len(SHEET_PETS)} 張')


if __name__ == '__main__':
    main()
