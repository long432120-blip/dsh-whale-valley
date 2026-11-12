// 打包 client 半：輸出 DSH 的模組格式，不是 ESM。
//
// 宿主的瀏覽器端是用 window.__ModuleLoader__.load({ id, factory }) 載入外掛的，
// factory 收到一個 require()，react 和 @deepseek-ai/* 都由宿主提供。
// 直接輸出 ESM 會在瀏覽器裡炸 "Cannot use import statement outside a module"。
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
const outfile = join(root, 'lib', 'client.js');

const result = await build({
  entryPoints: [join(root, 'src', 'client', 'dsh-entry.tsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  // 這些由宿主的 require 提供，不要打進來
  external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/*'],
  loader: { '.svg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl', '.tmj': 'json', '.tsj': 'json' },
  legalComments: 'none',
  logLevel: 'warning',
});

const body = result.outputFiles[0]!.text.trimEnd();

const wrapped = `// ${pkg.name} client bundle — 由 scripts/build-client.ts 產生，不要手改。
window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
${body
  .split('\n')
  .map((line) => (line ? '    ' + line : line))
  .join('\n')}
    return module.exports;
  }
});
`;

writeFileSync(outfile, wrapped, 'utf8');
console.log(`✓ ${outfile.replace(root + '\\', '')}（${(wrapped.length / 1024).toFixed(0)} KB）`);
