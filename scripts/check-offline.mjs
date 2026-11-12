#!/usr/bin/env node
// 去外部依賴化檢查：大陸玩家打不開 Google / 境外 CDN，所以出貨的檔案裡不能有這些。
// 用法：npm run check:offline   （有問題 exit 1）
// 白名單：AI 聊天（api.deepseek.com，玩家自己填 Key 才會連）、SVG 命名空間、URL 解析用的 127.0.0.1。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['lib', 'demo/pixel-standalone.html', 'demo/standalone.html', 'demo/pixel.html', 'demo/index.html', 'src', 'locales'];
const EXT = new Set(['.js', '.mjs', '.ts', '.tsx', '.html', '.css', '.json']);

// 一定不能出現的東西（不管在哪）
const BANNED = [
  [/fonts\.googleapis|fonts\.gstatic|googleapis\.com|gstatic\.com/i, 'Google Fonts / Google API'],
  [/unpkg\.com|cdnjs\.cloudflare|cdn\.jsdelivr|esm\.sh|skypack/i, '境外 CDN'],
  [/firebase|google-analytics|googletagmanager|\bgtag\(/i, 'Firebase / Google Analytics'],
  [/@import\s+url\(\s*['"]?https?:/i, 'CSS 遠端 @import'],
  [/<script[^>]+src=["']https?:/i, '遠端 <script src>'],
  [/<link[^>]+href=["']https?:/i, '遠端 <link href>'],
];
// 允許出現的網址主機
const ALLOWED_HOSTS = new Set(['api.deepseek.com', 'www.w3.org', '127.0.0.1', 'localhost']);

function* walk(p) {
  if (!existsSync(p)) return;
  if (statSync(p).isDirectory()) { for (const f of readdirSync(p)) yield* walk(join(p, f)); }
  else if (EXT.has(extname(p))) yield p;
}

const problems = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const [re, why] of BANNED) if (re.test(line)) problems.push(`${file}:${i + 1}  ${why}`);
      // 只檢查出貨檔（lib、demo html）裡的網址；src 裡的註解/測試網址交給上面的黑名單
      if (!file.startsWith('src') && !file.startsWith('locales')) {
        for (const m of line.matchAll(/https?:\/\/([a-zA-Z0-9.\-]+)/g)) {
          if (!ALLOWED_HOSTS.has(m[1])) problems.push(`${file}:${i + 1}  外部網址 ${m[1]}`);
        }
      }
    });
  }
}

if (problems.length) {
  console.error(`✗ 發現 ${problems.length} 個外部依賴：`);
  for (const p of [...new Set(problems)].slice(0, 50)) console.error('  ' + p);
  process.exit(1);
}
console.log('✓ check:offline 通過：沒有 Google Fonts / CDN / Firebase / GA；只剩 AI 聊天會連 api.deepseek.com');
