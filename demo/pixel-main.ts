// V0.2 像素版（伺服器版）：從 packs/ 讀角色包與 Tiled 地圖，可以用 ?pack=資料夾名 換角色包。
// 改了地圖或 JSON，重新整理就生效。
import { loadPixelPack, urlSource } from '../src/client/pixel/pack-loader.ts';
import { loadGameplay } from '../src/shared/gameplay-pack.ts';
import type { GameplayFile } from '../src/shared/gameplay-types.ts';
import { mountGame } from '../src/client/game-shell.ts';
import { i18n } from '../src/client/i18n.ts';
import { showFatal, startDemo } from './ui.ts';

async function main() {
  i18n().install(document); // V0.22：選了簡體就整頁轉簡體
  const packName = new URLSearchParams(location.search).get('pack') ?? 'whale-girl-pixel';
  if (!/^[a-z0-9-]+$/.test(packName)) throw new Error('pack 名稱只能是小寫英數與 -');
  const base = new URL(`../packs/${packName}/`, location.href);
  const pack = await loadPixelPack(urlSource(base));
  // 玩法定義在 DSH 裡由 host 讀（還會合併 mods/）；Demo 沒有 host，就直接讀角色包裡的五個玩法 JSON
  const gameplay: GameplayFile | null = await loadGameplay(async (n) => {
    const r = await fetch(new URL(n, base));
    return r.ok ? r.json() : null;
  }).catch(() => null);
  const ai = await fetch(new URL('ai.json', base)).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined);
  await startDemo({
    title: '鯨魚谷物語',
    ai,
    sceneNames: Object.fromEntries(pack.world.scenes.map((s) => [s.id, s.name])),
    initialScene: pack.world.initialScene,
    storageKey: `dsh-whale-pet:${packName}`,
    gameplay,
    mount: (root, bridge, onView) => mountGame(root, { pack, bridge, pollMs: 10_000, onView }),
  });
}

main().catch((err) => showFatal(err, `dsh-whale-pet:${new URLSearchParams(location.search).get('pack') ?? 'whale-girl-pixel'}`));
