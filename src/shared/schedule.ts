// 作息：依時段決定她想待在哪個場景、接下來要走去哪。純函數，rng 由外部注入。
import { reachable } from './path.ts';
import type { MapModel, PixelCharacterFile, SpotDef, TilePos } from './pixel-types.ts';
import type { DayPhase } from './types.ts';

export function scheduledScene(ch: PixelCharacterFile, phase: DayPhase): string | undefined {
  return ch.schedule?.[phase]?.scene;
}

export type Destination = { kind: 'spot'; spot: SpotDef } | { kind: 'wander'; tile: TilePos };

/**
 * 決定下一個目的地：
 * - 現在的場景就是作息指定的場景 → 七成機率去作息裡的地點，三成在附近閒晃
 * - 不在作息指定的場景（例如被主人帶出來）→ 地圖上任何地點或閒晃
 */
export function pickDestination(
  ch: PixelCharacterFile,
  phase: DayPhase,
  sceneId: string,
  map: MapModel,
  from: TilePos,
  rng: () => number,
): Destination | null {
  const plan = ch.schedule?.[phase];
  const planned = plan && plan.scene === sceneId ? plan.spots.map((n) => map.spots[n]).filter((s): s is SpotDef => !!s) : [];
  const pool = planned.length ? planned : Object.values(map.spots);
  const wantSpot = pool.length > 0 && rng() < (planned.length ? 0.7 : 0.4);
  if (wantSpot) {
    const choices = pool.filter((s) => s.tile.x !== from.x || s.tile.y !== from.y);
    if (choices.length) return { kind: 'spot', spot: choices[Math.floor(rng() * choices.length)]! };
  }
  const tile = randomNearbyTile(map, from, 4, rng);
  return tile ? { kind: 'wander', tile } : null;
}

/** 在 radius 格內隨機挑一個走得到、且不是門口的格子 */
export function randomNearbyTile(map: MapModel, from: TilePos, radius: number, rng: () => number): TilePos | null {
  const canReach = reachable(map, from);
  const doorTiles = new Set(map.doors.flatMap((d) => (d.stand ? [`${d.stand.x},${d.stand.y}`] : [])));
  const candidates: TilePos[] = [];
  for (let y = from.y - radius; y <= from.y + radius; y++) {
    for (let x = from.x - radius; x <= from.x + radius; x++) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      if (!canReach[y * map.width + x] || doorTiles.has(`${x},${y}`)) continue;
      if (Math.abs(x - from.x) + Math.abs(y - from.y) < 2) continue;
      candidates.push({ x, y });
    }
  }
  return candidates.length ? candidates[Math.floor(rng() * candidates.length)]! : null;
}
