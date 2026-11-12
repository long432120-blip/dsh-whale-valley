// 產生雙擊就能開的單檔 HTML：把 demo 頁的外部腳本換成內嵌的打包結果。
// 用法：npm run demo:standalone
//   demo/standalone.html        ← V0.1（DOM 版）
//   demo/pixel-standalone.html  ← V0.2（像素版）
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = join(import.meta.dirname, '..');
const targets = [
  { entry: 'demo/standalone.ts', template: 'demo/index.html', script: './demo.js', out: 'demo/standalone.html' },
  { entry: 'demo/pixel-standalone.ts', template: 'demo/pixel.html', script: './pixel.js', out: 'demo/pixel-standalone.html' },
];

for (const t of targets) {
  const result = await build({
    entryPoints: [join(root, t.entry)],
    bundle: true,
    format: 'iife', // 一般 <script> 在 file:// 也能執行
    target: 'es2022',
    minify: true,
    write: false,
    loader: { '.svg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl', '.tmj': 'json', '.tsj': 'json' },
  });
  const js = result.outputFiles[0]!.text.replaceAll('</script', '<\\/script');
  const template = await readFile(join(root, t.template), 'utf8');
  const tag = `<script type="module" src="${t.script}"></script>`;
  if (!template.includes(tag)) throw new Error(`${t.template} 裡找不到 ${t.script} 的 <script>`);
  const html = template.replace(tag, () => `<script>${js}</script>`);
  await writeFile(join(root, t.out), html, 'utf8');
  console.log(`✓ ${t.out}（${Math.round(html.length / 1024)} KB）`);
}

// V0.14：背景音樂太大不內嵌（約 10 MB）：複製到 html 旁邊的 music/。發給朋友時要連 music/ 資料夾一起給
await cp(join(root, 'packs', 'whale-girl-pixel', 'music'), join(root, 'demo', 'music'), { recursive: true });
console.log('✓ demo/music/（背景音樂，跟 pixel-standalone.html 放在一起）');
