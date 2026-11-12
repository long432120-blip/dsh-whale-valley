// V0.22：DSH 裡的背景音樂。
//
// DSH 實機驗收發現：client 去抓 `/music/farm-day.mp3` 會 404（DSH 沒有這條路由），所以 DSH 版一直沒聲音。
// 這裡讓 host 用插件自己的通道提供音樂檔：GET /api/dsh-whale-valley/music/<檔名>
//
// 安全：
//   - 只給 music.json 裡列出的檔名（白名單），不接受任何路徑（沒有 /、\、..）
//   - 只讀插件資料夾裡的 packs/whale-girl-pixel/music/
//   - 只接受 GET／HEAD；支援 Range（<audio> 跳轉、續播會用到）
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

const TYPES: Record<string, string> = { mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', wav: 'audio/wav' };

/** music.json → 允許的檔名（只取檔名本身） */
export function musicWhitelist(file: { tracks?: Record<string, { src?: string }> } | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of Object.values(file?.tracks ?? {})) {
    const name = (t?.src ?? '').split('/').pop() ?? '';
    if (/^[\w.-]+\.(mp3|ogg|m4a|wav)$/i.test(name) && !name.startsWith('.')) out.add(name);
  }
  return out;
}

/** 解析 Range: bytes=a-b；不合法回 null（照整個檔案給），超出範圍回 'bad' */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'bad' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // bytes=-500：最後 500 bytes
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'bad';
  return { start, end };
}

/**
 * 處理 /music/<name>：成功或錯誤都會寫好 response。
 * @param name 網址最後的檔名（已經 decode）
 */
export async function serveMusic(req: IncomingMessage, res: ServerResponse, dir: string, allowed: Set<string>, name: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  if (!allowed.has(name)) {
    res.writeHead(404).end();
    return;
  }
  await serveFile(req, res, join(dir, name), TYPES[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream', 'private, max-age=86400');
}

/** 送出一個檔案（支援 Range）；檔案不存在回 404。V0.23：遊戲頁的 client.js 也用這個 */
export async function serveFile(req: IncomingMessage, res: ServerResponse, path: string, type: string, cacheControl: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  let size: number;
  try {
    const st = await stat(path);
    if (!st.isFile()) throw new Error('not a file');
    size = st.size;
  } catch {
    // 角色包沒有附音樂檔（例如自己改的角色包）：安靜地 404，client 會改成不放音樂
    res.writeHead(404).end();
    return;
  }
  const headers: Record<string, string | number> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
  };
  const range = parseRange(req.headers.range, size);
  if (range === 'bad') {
    res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  headers['content-length'] = end - start + 1;
  if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(path, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
