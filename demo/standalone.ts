// V0.1 雙擊版 Demo：角色包在打包時整個內嵌（JSON + 圖片轉成 data URL），
// 產出的 standalone.html 不需要伺服器，直接用瀏覽器打開就能跑。
import character from '../packs/whale-girl/character.json';
import scenes from '../packs/whale-girl/scenes.json';
import garden from '../packs/whale-girl/assets/garden.svg';
import room from '../packs/whale-girl/assets/room.svg';
import idle from '../packs/whale-girl/assets/whale-girl-idle.webp';
import { mountStage } from '../src/client/stage.ts';
import type { CharacterFile, ScenesFile } from '../src/shared/types.ts';
import { showFatal, startDemo } from './ui.ts';

const ASSETS: Record<string, string> = {
  'assets/room.svg': room,
  'assets/garden.svg': garden,
  'assets/whale-girl-idle.webp': idle,
};
const sc = scenes as unknown as ScenesFile; // JSON 推出的型別比較寬，這裡明確收窄
const ch = character as unknown as CharacterFile;

startDemo({
  title: `${ch.name} · DSH 養成 Demo`,
  sceneNames: Object.fromEntries(sc.scenes.map((s) => [s.id, s.name])),
  initialScene: sc.initialScene,
  storageKey: 'dsh-whale-pet:standalone',
  mount: (root, bridge, onView) =>
    mountStage(root, {
      scenes: sc,
      character: ch,
      bridge,
      resolveAsset: (p) => {
        const url = ASSETS[p];
        if (!url) throw new Error(`standalone.ts 的 ASSETS 沒有登記：${p}`);
        return url;
      },
      pollMs: 10_000,
      onView,
    }),
}).catch(showFatal);
