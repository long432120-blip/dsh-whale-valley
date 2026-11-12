// V0.22：簡單的敏感詞過濾（聊天室、信箱、暱稱、寵物名字共用）
// 詞庫在角色包 social.json 的 chat.blocked（繁簡兩種寫法都列），allow 是不該被擋的詞（例如「幹嘛」「樹幹」）。
// 會擋：中間插空白或符號（白 痴、白.痴）、全形英文（ｆｕｃｋ）、大小寫。
// 擋不住：同音字、拆字、圖片……這只是「防髒話」，不是內容審查。

export interface FilterDef {
  blocked: string[];
  allow?: string[];
}

export interface FilterResult {
  text: string;
  /** 有沒有字被遮掉 */
  hit: boolean;
}

/** 全形英數 → 半形、英文轉小寫（長度不變，位置可以對回原文） */
function normalize(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c >= 0xff01 && c <= 0xff5e ? String.fromCodePoint(c - 0xfee0) : ch;
  }
  return out.toLowerCase();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEP = '[\\s\\p{P}\\p{S}_]{0,3}';

export function makeFilter(def: FilterDef | undefined): (text: string) => FilterResult {
  const words = [...new Set((def?.blocked ?? []).map((w) => normalize(w.trim())).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!words.length) return (text) => ({ text, hit: false });
  const re = new RegExp(words.map((w) => [...w].map(escape).join(SEP)).join('|'), 'gu');
  const allow = [...new Set((def?.allow ?? []).map((w) => normalize(w)).filter(Boolean))];
  return (text: string) => {
    const src = String(text ?? '');
    // normalize 會把全形英文換成一個半形字，所以要用「字」（code point）來對位置
    const chars = [...src];
    const norm = chars.map((c) => normalize(c)).join('');
    // allow 詞的範圍（用 normalize 後的 UTF-16 位置）
    const safe: [number, number][] = [];
    for (const a of allow) for (let i = norm.indexOf(a); i >= 0; i = norm.indexOf(a, i + 1)) safe.push([i, i + a.length]);
    const masks: [number, number][] = [];
    for (const m of norm.matchAll(re)) {
      const s = m.index!;
      const e = s + m[0].length;
      if (safe.some(([a, b]) => s >= a && e <= b)) continue;
      masks.push([s, e]);
    }
    if (!masks.length) return { text: src, hit: false };
    // UTF-16 位置 → 第幾個字
    let pos = 0;
    const out = chars.map((c) => {
      const n = normalize(c);
      const start = pos;
      pos += n.length;
      return masks.some(([s, e]) => start < e && start + n.length > s) ? '＊' : c;
    });
    return { text: out.join(''), hit: true };
  };
}
