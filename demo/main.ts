// V0.1 伺服器版 Demo：從 packs/ 讀角色包，可以用 ?pack=資料夾名 換角色。
// 需要透過 http 伺服器開（瀏覽器不允許 file:// fetch JSON）；想雙擊開請用 standalone.html。
import { mountStage } from '../src/client/stage.ts';
import type { CharacterFile, ScenesFile } from '../src/shared/types.ts';
import { showFatal, startDemo } from './ui.ts';

async function main() {
  const packName = new URLSearchParams(location.search).get('pack') ?? 'whale-girl';
  if (!/^[a-z0-9-]+$/.test(packName)) throw new Error('pack 名稱只能是小寫英數與 -');
  const packBase = new URL(`../packs/${packName}/`, location.href);

  const getJson = async <T,>(file: string): Promise<T> => {
    const res = await fetch(new URL(file, packBase));
    if (!res.ok) throw new Error(`讀不到 ${file}（HTTP ${res.status}）`);
    return res.json() as Promise<T>;
  };
  const [scenes, character] = await Promise.all([
    getJson<ScenesFile>('scenes.json'),
    getJson<CharacterFile>('character.json'),
  ]);

  await startDemo({
    title: `${character.name} · DSH 養成 Demo`,
    sceneNames: Object.fromEntries(scenes.scenes.map((s) => [s.id, s.name])),
    initialScene: scenes.initialScene,
    storageKey: `dsh-whale-pet:${packName}`,
    mount: (root, bridge, onView) =>
      mountStage(root, { scenes, character, bridge, resolveAsset: (p) => new URL(p, packBase).href, pollMs: 10_000, onView }),
  });
}

main().catch(showFatal);
