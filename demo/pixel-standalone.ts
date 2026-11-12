// 像素版（雙擊版）：角色包、地圖、圖片全部在打包時內嵌，產出的 pixel-standalone.html 直接打開就能跑。
// 要內嵌哪些檔案寫在 src/client/pixel/bundled-pack.ts（DSH 客戶端也用同一份）。
import { bundledGameplay, bundledPack } from '../src/client/pixel/bundled-pack.ts';
import { loadPixelPack } from '../src/client/pixel/pack-loader.ts';
import { mountGame } from '../src/client/game-shell.ts';
import { i18n } from '../src/client/i18n.ts';
import { showFatal, startDemo } from './ui.ts';
import aiJson from '../packs/whale-girl-pixel/ai.json';
import type { AiFile } from '../src/shared/ai.ts';

async function main() {
  i18n().install(document); // V0.22：選了簡體就整頁轉簡體
  const pack = await loadPixelPack(bundledPack);
  await startDemo({
    title: '鯨魚谷物語',
    sceneNames: Object.fromEntries(pack.world.scenes.map((s) => [s.id, s.name])),
    initialScene: pack.world.initialScene,
    // V0.20 改名鯨魚谷物語，但瀏覽器存檔的 key 不改：玩家的舊存檔才讀得到
    storageKey: 'dsh-whale-pet:pixel-standalone',
    gameplay: bundledGameplay,
    ai: aiJson as unknown as AiFile, // V0.20：玩家自己填 Key 才會用到；程式碼裡沒有任何 Key
    mount: (root, bridge, onView) => mountGame(root, { pack, bridge, pollMs: 10_000, onView }),
  });
}

main().catch((err) => showFatal(err, 'dsh-whale-pet:pixel-standalone'));
