// 發布前檢查：要提交到 GitHub、要打包的檔案裡，有沒有真的 API Key、Token、個人 email、本機路徑。
//   npm run check:secrets
// 有 git 就只看 git 會提交的檔案（尊重 .gitignore）；沒有 git 就掃整個資料夾（略過 node_modules 等）。
// 找到就列出來並以代碼 1 結束；測試用的假 Key（含 test、fake、example、xxxx）不算。
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'release', 'source', '__pycache__']);
const BINARY = /\.(png|jpe?g|webp|gif|ico|mp3|ogg|wav|zip|tgz|gz|woff2?|ttf)$/i;

function listFiles() {
  try {
    // -z：用 \0 分隔，中文檔名才不會被跳脫成 "\350\250…" 而讀不到
    const out = execSync('git ls-files -z -co --exclude-standard', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const files = out.split('\0').filter(Boolean);
    if (files.length) return { files, how: 'git（只看會提交的檔案）' };
  } catch { /* 沒有 git 或還沒 git init */ }
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(root);
  return { files, how: '整個資料夾' };
}

const FAKE = /test|fake|example|dummy|x{4,}|0{8,}/i;
const RULES = [
  { name: 'API Key（sk-…）', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, fake: true },
  { name: 'GitHub Token', re: /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/g },
  { name: 'Slack Token', re: /\bxox[abps]-[A-Za-z0-9-]{10,}/g },
  { name: 'AWS Key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: '私鑰', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: '個人 email', re: /[A-Za-z0-9._%+-]+@(?:gmail|qq|163|126|outlook|hotmail|yahoo|icloud|foxmail)\.[a-z.]+/gi },
  { name: '本機使用者路徑', re: /[A-Za-z]:[\\/]+Users[\\/]+(?!%|\$|<|Public\b)[^\\/\s'"`]+|\/Users\/(?!<)[a-z][^/\s'"`]*\/|\/home\/(?!claude\b|<|user\b|u\b)[a-z][^/\s'"`]*\//g },
];

const { files, how } = listFiles();
const problems = [];
for (const f of files) {
  if (BINARY.test(f)) continue;
  const base = f.split('/').pop();
  if (/^\.env(\..*)?$/.test(base) && base !== '.env.example') {
    problems.push({ file: f, line: 0, rule: '.env 檔', text: '.env 不應該被提交（應該在 .gitignore 裡）' });
    continue;
  }
  if (base === '.npmrc' || /\.(pem|key|p12)$/.test(base)) {
    problems.push({ file: f, line: 0, rule: '登入設定／金鑰檔', text: `${base} 可能含有 Token 或私鑰，不應該被提交（應該在 .gitignore 裡）` });
    continue;
  }
  if (f === 'scripts/check-secrets.mjs') continue;
  let text;
  try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
  // 打包進去的圖片是 base64：先拿掉，避免誤判
  const lines = text.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, 'data:…').split('\n');
  lines.forEach((line, i) => {
    for (const r of RULES) {
      for (const m of line.matchAll(r.re)) {
        if (r.fake && FAKE.test(m[0])) continue;
        if (r.name === '個人 email' && /noreply/i.test(m[0])) continue;
        problems.push({ file: f, line: i + 1, rule: r.name, text: m[0].length > 24 ? `${m[0].slice(0, 10)}…${m[0].slice(-4)}` : m[0] });
      }
    }
  });
}

console.log(`掃描 ${files.length} 個檔案（${how}）`);
if (!problems.length) {
  console.log('✅ 沒有找到 API Key、Token、個人 email 或本機路徑。');
  process.exit(0);
}
console.error(`❌ 找到 ${problems.length} 個可疑的地方（發布前請處理）：`);
for (const p of problems) console.error(`  ${p.file}${p.line ? `:${p.line}` : ''}  [${p.rule}]  ${p.text}`);
process.exit(1);
