"""產生 locales/t2s-chars.json：繁體字 → 簡體字（單字對照）。

用系統的 ICU（libicui18n）的 "Traditional-Simplified" 轉換，掃 CJK 基本區＋擴充 A，只留轉了會變的字。
只在開發時跑一次；遊戲執行時只讀產生好的 JSON，不需要 ICU。
    python3 tools/gen_t2s.py
"""
import ctypes, json, sys, os

def load(name):
    for v in range(80, 60, -1):
        try:
            return ctypes.CDLL(f'lib{name}.so.{v}'), v
        except OSError:
            continue
    sys.exit(f'找不到 lib{name}（需要 ICU）')

i18n, ver = load('icui18n')
uc, _ = load('icuuc')
fn = lambda lib, n: getattr(lib, f'{n}_{ver}')
UChar = ctypes.c_uint16
err = ctypes.c_int(0)
tid = 'Traditional-Simplified'
idbuf = (UChar * (len(tid) + 1))(*[ord(c) for c in tid], 0)
open_ = fn(i18n, 'utrans_openU'); open_.restype = ctypes.c_void_p
tr = open_(idbuf, len(tid), 0, None, 0, None, ctypes.byref(err))
if err.value > 0: sys.exit(f'utrans_openU 失敗 {err.value}')
conv = fn(i18n, 'utrans_transUChars')
conv.argtypes = [ctypes.c_void_p, ctypes.POINTER(UChar), ctypes.POINTER(ctypes.c_int32), ctypes.c_int32, ctypes.c_int32, ctypes.POINTER(ctypes.c_int32), ctypes.POINTER(ctypes.c_int)]

def t2s(ch):
    units = list(ch.encode('utf-16-le'))
    u16 = [units[i] | (units[i + 1] << 8) for i in range(0, len(units), 2)]
    cap = 16
    buf = (UChar * cap)(*u16)
    length = ctypes.c_int32(len(u16)); limit = ctypes.c_int32(len(u16)); e = ctypes.c_int(0)
    conv(tr, buf, ctypes.byref(length), cap, 0, ctypes.byref(limit), ctypes.byref(e))
    if e.value > 0: return ch
    return bytes(b for u in buf[:length.value] for b in (u & 0xff, u >> 8)).decode('utf-16-le')

out = {}
for cp in list(range(0x3400, 0x4DC0)) + list(range(0x4E00, 0xA000)):
    c = chr(cp)
    s = t2s(c)
    if s != c and len(s) == 1:
        out[c] = s
root = os.path.join(os.path.dirname(__file__), '..', 'locales')
os.makedirs(root, exist_ok=True)
# 一個長字串比 JSON 物件小很多：「繁簡繁簡…」兩兩一組
pairs = ''.join(k + v for k, v in sorted(out.items()))
json.dump({'_說明': '繁→簡單字對照，兩個字一組（繁、簡）。由 tools/gen_t2s.py 用 ICU 產生，不要手改；用語差異寫在 zh-CN.json 的 terms。', 'pairs': pairs},
          open(os.path.join(root, 't2s-chars.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print(len(out), '字')
