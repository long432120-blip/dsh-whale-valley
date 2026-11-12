// 格子地圖上的尋路（4 方向 A*）與可達範圍（BFS）。地圖很小，用最直白的寫法就夠快。
import type { TilePos } from './pixel-types.ts';

export interface Grid {
  width: number;
  height: number;
  /** width*height；true = 不能走 */
  blocked: ArrayLike<boolean>;
}

const DIRS: TilePos[] = [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }];
const inside = (g: Grid, x: number, y: number) => x >= 0 && y >= 0 && x < g.width && y < g.height;
const open = (g: Grid, x: number, y: number) => inside(g, x, y) && !g.blocked[y * g.width + x];

/**
 * 回傳從 from 走到 to 的格子序列（不含起點、含終點）。
 * 起點等於終點回傳 []；走不到回傳 null。
 */
export function findPath(g: Grid, from: TilePos, to: TilePos): TilePos[] | null {
  if (!open(g, to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const idx = (x: number, y: number) => y * g.width + x;
  const h = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y);
  const gScore = new Map<number, number>([[idx(from.x, from.y), 0]]);
  const came = new Map<number, number>();
  const openList: { i: number; f: number; g: number }[] = [{ i: idx(from.x, from.y), f: h(from.x, from.y), g: 0 }];
  const closed = new Set<number>();

  while (openList.length) {
    let best = 0;
    for (let k = 1; k < openList.length; k++) if (openList[k]!.f < openList[best]!.f) best = k;
    const cur = openList.splice(best, 1)[0]!;
    if (closed.has(cur.i)) continue;
    closed.add(cur.i);
    const cx = cur.i % g.width;
    const cy = (cur.i - cx) / g.width;
    if (cx === to.x && cy === to.y) {
      const path: TilePos[] = [];
      let i = cur.i;
      while (i !== idx(from.x, from.y)) {
        const x = i % g.width;
        path.push({ x, y: (i - x) / g.width });
        i = came.get(i)!;
      }
      return path.reverse();
    }
    for (const d of DIRS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (!open(g, nx, ny)) continue;
      const ni = idx(nx, ny);
      const ng = cur.g + 1;
      if (ng < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, ng);
        came.set(ni, cur.i);
        openList.push({ i: ni, g: ng, f: ng + h(nx, ny) });
      }
    }
  }
  return null;
}

/** 從 from 出發到每一格要走幾步（走不到是 Infinity）：用來挑最近的站位 */
export function distances(g: Grid, from: TilePos): number[] {
  const dist = new Array<number>(g.width * g.height).fill(Infinity);
  if (!open(g, from.x, from.y)) return dist;
  const queue: TilePos[] = [from];
  dist[from.y * g.width + from.x] = 0;
  while (queue.length) {
    const c = queue.shift()!;
    const dc = dist[c.y * g.width + c.x]!;
    for (const d of DIRS) {
      const nx = c.x + d.x;
      const ny = c.y + d.y;
      if (open(g, nx, ny) && dist[ny * g.width + nx] === Infinity) {
        dist[ny * g.width + nx] = dc + 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return dist;
}

/** 從 from 出發走得到的所有格子（給角色包檢查用：門和地點是不是都走得到） */
export function reachable(g: Grid, from: TilePos): boolean[] {
  const seen = new Array<boolean>(g.width * g.height).fill(false);
  if (!open(g, from.x, from.y)) return seen;
  const queue: TilePos[] = [from];
  seen[from.y * g.width + from.x] = true;
  while (queue.length) {
    const c = queue.shift()!;
    for (const d of DIRS) {
      const nx = c.x + d.x;
      const ny = c.y + d.y;
      if (open(g, nx, ny) && !seen[ny * g.width + nx]) {
        seen[ny * g.width + nx] = true;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return seen;
}
