// V0.22：玩家之間傳來傳去的「碼」（邀請碼、回信碼、攤位碼、收款碼、領養碼）
//
// 格式：WV1.<種類>.<編碼>.<內容>.<校驗碼>
//   種類：visit / reply / stall / receipt / pet
//   編碼：j = UTF-8 JSON 直接轉 Base64URL；z = 先用 deflate 壓縮再轉（拜訪碼比較大才用）
//   校驗碼：checksum("<種類>.<編碼>.<內容>", salt)，兩個不同種子的 53-bit 雜湊接起來（約 20 個字）
//
// ⚠️ 誠實說明：salt 寫在開源的程式碼裡，所以這個校驗碼只能擋「手改碼裡的數字」這種隨手作弊，
// 擋不住會看程式碼、自己重算校驗碼的人。真正擋作弊的是規則層（trade.ts）：
// 每個欄位都有合理範圍、每張碼只能兌換一次、送出去的東西會從自己的存檔拿走。
// 要做到真正防偽，需要伺服器簽章（之後接上伺服器時換掉 checksum 就好）。

export type CodeKind = 'visit' | 'reply' | 'stall' | 'receipt' | 'pet';
export const CODE_PREFIX = 'WV1';
/** 貼上的碼最長多少字（拜訪碼壓縮後通常 1～4 KB） */
export const MAX_CODE_LENGTH = 30_000;

export type DecodeError = 'format' | 'kind' | 'checksum' | 'json' | 'too_long';
export type Decoded<T = unknown> = { ok: true; kind: CodeKind; payload: T } | { ok: false; reason: DecodeError };

/** cyrb53：小而快的 53-bit 字串雜湊（公開演算法） */
function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 內容 + salt 的校驗碼（兩個種子，碰撞機率約 2^-106） */
export function checksum(text: string, salt: string): string {
  return cyrb53(`${salt}|${text}`, 1).toString(36) + cyrb53(`${text}|${salt}`, 7).toString(36);
}

// ── Base64URL（UTF-8 安全；瀏覽器和 Node 都有 btoa／atob、TextEncoder） ──
export function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function wrap(kind: CodeKind, encoding: 'j' | 'z', body: string, salt: string): string {
  const head = `${kind}.${encoding}.${body}`;
  return `${CODE_PREFIX}.${head}.${checksum(head, salt)}`;
}

/** 拆開並檢查格式、種類、校驗碼；回傳內容的位元組（還沒解壓、還沒 parse） */
function unwrap(code: string, salt: string, expect: CodeKind | readonly CodeKind[]):
  { ok: true; kind: CodeKind; encoding: 'j' | 'z'; bytes: Uint8Array } | { ok: false; reason: DecodeError } {
  if (typeof code !== 'string') return { ok: false, reason: 'format' };
  // 聊天軟體常會在長字串中間插換行、空白：全部拿掉
  const s = code.replace(/\s+/g, '');
  if (s.length > MAX_CODE_LENGTH) return { ok: false, reason: 'too_long' };
  const m = /^WV1\.(visit|reply|stall|receipt|pet)\.([jz])\.([A-Za-z0-9_-]+)\.([0-9a-z]{6,24})$/.exec(s);
  if (!m) return { ok: false, reason: 'format' };
  const kind = m[1] as CodeKind;
  const kinds = typeof expect === 'string' ? [expect] : expect;
  if (!kinds.includes(kind)) return { ok: false, reason: 'kind' };
  if (checksum(`${kind}.${m[2]}.${m[3]}`, salt) !== m[4]) return { ok: false, reason: 'checksum' };
  try {
    return { ok: true, kind, encoding: m[2] as 'j' | 'z', bytes: b64urlToBytes(m[3]!) };
  } catch {
    return { ok: false, reason: 'format' };
  }
}

function parse(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(dec.decode(bytes)) };
  } catch {
    return { ok: false };
  }
}

/** 小的碼（攤位、收款、領養、回信）：同步，規則層可以直接用 */
export function encodeCode(kind: CodeKind, payload: unknown, salt: string): string {
  return wrap(kind, 'j', bytesToB64url(enc.encode(JSON.stringify(payload))), salt);
}

export function decodeCode<T = unknown>(code: string, salt: string, expect: CodeKind | readonly CodeKind[]): Decoded<T> {
  const u = unwrap(code, salt, expect);
  if (!u.ok) return u;
  if (u.encoding !== 'j') return { ok: false, reason: 'format' }; // 壓縮過的要用 decodeCodeAsync
  const p = parse(u.bytes);
  return p.ok ? { ok: true, kind: u.kind, payload: p.value as T } : { ok: false, reason: 'json' };
}

// ── 壓縮版（拜訪碼）：CompressionStream 是非同步的，只在瀏覽器端用 ──
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const canCompress = (): boolean => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

export async function encodeCodeAsync(kind: CodeKind, payload: unknown, salt: string): Promise<string> {
  const raw = enc.encode(JSON.stringify(payload));
  if (!canCompress()) return wrap(kind, 'j', bytesToB64url(raw), salt);
  return wrap(kind, 'z', bytesToB64url(await pipe(raw, new CompressionStream('deflate'))), salt);
}

export async function decodeCodeAsync<T = unknown>(code: string, salt: string, expect: CodeKind | readonly CodeKind[]): Promise<Decoded<T>> {
  const u = unwrap(code, salt, expect);
  if (!u.ok) return u;
  let bytes = u.bytes;
  if (u.encoding === 'z') {
    if (!canCompress()) return { ok: false, reason: 'format' };
    try {
      bytes = await pipe(bytes, new DecompressionStream('deflate'));
    } catch {
      return { ok: false, reason: 'json' };
    }
    if (bytes.length > 2_000_000) return { ok: false, reason: 'too_long' }; // 解壓炸彈
  }
  const p = parse(bytes);
  return p.ok ? { ok: true, kind: u.kind, payload: p.value as T } : { ok: false, reason: 'json' };
}
