// 測試用：從 packs/whale-girl-pixel 讀完整的玩法定義（五個 JSON 組起來）
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGameplay } from '../src/shared/gameplay-pack.ts';
import type { GameplayFile } from '../src/shared/gameplay-types.ts';

export const PACK_DIR = join(import.meta.dirname, '..', 'packs', 'whale-girl-pixel');
export async function packGameplay(): Promise<GameplayFile> {
  return (await loadGameplay(async (n) => JSON.parse(await readFile(join(PACK_DIR, n), 'utf8'))))!;
}
