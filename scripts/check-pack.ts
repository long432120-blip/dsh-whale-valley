// 用法：npm run check:pack -- whale-girl
// 檢查 JSON 結構、場景互相連得到、圖片檔案存在。
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CharacterFile, ScenesFile } from '../src/shared/types.ts';
import { validatePack } from '../src/shared/validate.ts';

const pack = process.argv[2] ?? 'whale-girl';
const dir = join(import.meta.dirname, '..', 'packs', pack);
const readJson = async <T>(f: string) => JSON.parse(await readFile(join(dir, f), 'utf8')) as T;

const scenes = await readJson<ScenesFile>('scenes.json');
const character = await readJson<CharacterFile>('character.json');
const errors = validatePack(scenes, character);

const files = [
  ...scenes.scenes.map((s) => s.background),
  ...Object.values(character.sprites).flatMap((sp) => (sp ? [sp.src] : [])),
];
for (const f of files) {
  try {
    await access(join(dir, f));
  } catch {
    errors.push(`找不到圖片：packs/${pack}/${f}`);
  }
}

if (errors.length) {
  console.error(`✗ packs/${pack} 有 ${errors.length} 個問題：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ packs/${pack} 檢查通過：${scenes.scenes.length} 個場景、${character.lines.length} 句台詞`);
