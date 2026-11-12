// V0.6 寵物圖層：寵物的移動（跟隨、閒逛、狗去撿東西）、地上的掉落物、野生寵物的位置與繪製。
// 規則（能不能撿、抓不抓得到）全在 host；這裡只決定「畫在哪、怎麼走」，位置用日期與 id 算，重開畫面也一樣。
import type { ForageSpot, GameplayDefs, PetSpeciesDef, PetView, WildSpawn } from '../../shared/gameplay-types.ts';
import type { MapModel, TilePos } from '../../shared/pixel-types.ts';
import { distances, findPath } from '../../shared/path.ts';
import { hashSeed } from '../../shared/pets.ts';

export interface PetLayerHost {
  ctx: CanvasRenderingContext2D;
  TS: number;
  rng: () => number;
  map(): MapModel;
  sceneId(): string;
  /** 遊戲裡的「今天」：掉落物每天換位置 */
  day(): string;
  origin(): { ox: number; oy: number; scale: number };
  game(): { pets: PetView[]; companion: number | null; wild: WildSpawn[]; forage: ForageSpot[] } | null;
  defs(): GameplayDefs | null;
  /** 跟班要跟誰：主人自己走時跟主人，否則跟鯨魚娘；她不在（礦洞）時是 null */
  leader(): { tile: TilePos; walking: boolean } | null;
  img(path?: string): HTMLImageElement | undefined;
  emojiAt(text: string, cx: number, cy: number, size: number, flip?: boolean): void;
  /** V0.10：物品有圖畫圖，沒有畫 emoji */
  itemAt?(itemId: string, emoji: string, cx: number, cy: number, size: number): void;
  shadow(cx: number, cy: number, w: number): void;
  /** 狗走到掉落物上：請 host 撿 */
  dogPickup(spot: ForageSpot, petId: number): void;
}

interface Actor {
  id: number;
  kind: string;
  tile: TilePos;
  px: number;
  py: number;
  path: TilePos[];
  walking: boolean;
  idleUntil: number;
  /** 往右走（翻轉用） */
  right: boolean;
  goal: { kind: 'forage'; key: string } | null;
  lastPlan: number;
  hopUntil: number;
  /** 偶爾冒一個小圖示（♪、💤、❤） */
  bubble: { text: string; until: number } | null;
}

const SCALE = 1 / 3; // 貼圖存成 3 倍大
const same = (a: TilePos, b: TilePos) => a.x === b.x && a.y === b.y;
const manhattan = (a: TilePos, b: TilePos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function createPetLayer(h: PetLayerHost) {
  const { TS } = h;
  const actors = new Map<number, Actor>();
  const trail: TilePos[] = [];
  let placeCache: { scene: string; day: string; free: TilePos[]; used: Map<string, TilePos> } | null = null;
  const throwing = new Map<string, number>(); // 野生寵物 id → 網子動畫結束時間
  const pickupPending = new Set<string>();

  const feet = (t: TilePos) => ({ x: t.x * TS + TS / 2, y: t.y * TS + TS - 2 });
  const speciesOf = (kind: string): PetSpeciesDef | undefined => h.defs()?.file.pets?.species[kind];

  // ───────────── 位置：掉落物、野生寵物放在哪一格 ─────────────
  /** 可以放東西的格子：走得到、不是門、不是互動物件、不是出生點、不在圍欄裡 */
  function freeTiles(m: MapModel): TilePos[] {
    const bad = new Set<string>();
    const mark = (r: { x: number; y: number; w: number; h: number }, pad = 0) => {
      for (let y = r.y - pad; y < r.y + r.h + pad; y++) for (let x = r.x - pad; x < r.x + r.w + pad; x++) bad.add(`${x},${y}`);
    };
    for (const it of m.interactables) {
      mark(it.rect);
      for (const s of it.stands) bad.add(`${s.x},${s.y}`);
    }
    for (const d of m.doors) {
      mark(d.rect, 1);
      if (d.stand) bad.add(`${d.stand.x},${d.stand.y}`);
    }
    for (const a of m.areas) mark(a.rect);
    for (const s of Object.values(m.spawns)) bad.add(`${s.tile.x},${s.tile.y}`);
    // 只放在「從出生點走得到」的地方，不然撿不到
    const start = m.spawns.default?.tile;
    const dist = start ? distances(m, start) : null;
    const out: TilePos[] = [];
    // 最上面三排會被狀態列、按鈕擋住：不放
    for (let y = 3; y < m.height - 1; y++) {
      for (let x = 1; x < m.width - 1; x++) {
        if (m.blocked[y * m.width + x] || bad.has(`${x},${y}`)) continue;
        if (dist && !Number.isFinite(dist[y * m.width + x]!)) continue;
        out.push({ x, y });
      }
    }
    return out;
  }

  /** key（例如 forage:garden:2）→ 固定的一格；同一張地圖不會重疊 */
  function tileFor(key: string): TilePos | null {
    const scene = h.sceneId();
    const day = h.day();
    if (!placeCache || placeCache.scene !== scene || placeCache.day !== day) {
      placeCache = { scene, day, free: freeTiles(h.map()), used: new Map() };
    }
    const c = placeCache;
    const hit = c.used.get(key);
    if (hit) return hit;
    if (!c.free.length) return null;
    const taken = new Set([...c.used.values()].map((t) => `${t.x},${t.y}`));
    const start = hashSeed(key) % c.free.length;
    for (let i = 0; i < c.free.length; i++) {
      const t = c.free[(start + i * 7) % c.free.length]!;
      if (taken.has(`${t.x},${t.y}`)) continue;
      c.used.set(key, t);
      return t;
    }
    return null;
  }

  const forageKey = (s: ForageSpot) => `forage:${h.day()}:${s.scene}:${s.slot}`;
  function forageHere(): { spot: ForageSpot; tile: TilePos }[] {
    const g = h.game();
    if (!g) return [];
    const scene = h.sceneId();
    return g.forage.filter((s) => s.scene === scene).map((spot) => ({ spot, tile: tileFor(forageKey(spot))! })).filter((x) => x.tile);
  }
  function wildHere(): { spawn: WildSpawn; tile: TilePos }[] {
    const g = h.game();
    if (!g) return [];
    const scene = h.sceneId();
    return g.wild.filter((w) => w.scene === scene).map((spawn) => ({ spawn, tile: tileFor(`wild:${spawn.id}`)! })).filter((x) => x.tile);
  }

  // ───────────── 寵物：誰在這張地圖 ─────────────
  function petsHere(): PetView[] {
    const g = h.game();
    if (!g) return [];
    const scene = h.sceneId();
    const lead = h.leader();
    return g.pets.filter((p) => (p.id === g.companion && lead ? true : p.home === scene));
  }

  function spawnActor(p: PetView): Actor {
    const m = h.map();
    const lead = h.leader();
    let tile: TilePos | null = null;
    if (p.id === h.game()?.companion && lead) {
      // 跟班：出現在主人旁邊
      for (const d of [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }]) {
        const t = { x: lead.tile.x + d.x, y: lead.tile.y + d.y };
        if (t.x >= 0 && t.y >= 0 && t.x < m.width && t.y < m.height && !m.blocked[t.y * m.width + t.x]) {
          tile = t;
          break;
        }
      }
      tile ??= { ...lead.tile };
    } else tile = tileFor(`pet:${p.id}`) ?? m.spawns.default?.tile ?? { x: 1, y: 1 };
    const f = feet(tile);
    return { id: p.id, kind: p.kind, tile, px: f.x, py: f.y, path: [], walking: false, idleUntil: performance.now() + 500 + h.rng() * 1500, right: h.rng() < 0.5, goal: null, lastPlan: 0, hopUntil: 0, bubble: null };
  }

  function walk(a: Actor, to: TilePos, maxLen = 40): boolean {
    const p = findPath(h.map(), a.tile, to);
    if (!p || !p.length || p.length > maxLen) return false;
    a.path = p;
    a.walking = true;
    return true;
  }

  /** 閒逛：附近隨便挑一格；狗看到掉落物會先去撿 */
  function decide(a: Actor, p: PetView, now: number, near: TilePos | null) {
    const sp = speciesOf(p.kind);
    const m = h.map();
    if (sp?.skill.kind === 'auto_pickup' && !p.hungry) {
      const dist = distances(m, a.tile);
      const radius = sp.skill.radius ?? 8;
      const best = forageHere()
        .filter((f) => !pickupPending.has(forageKey(f.spot)))
        .map((f) => ({ ...f, d: dist[f.tile.y * m.width + f.tile.x]! }))
        .filter((f) => Number.isFinite(f.d) && f.d <= radius)
        .sort((x, y) => x.d - y.d)[0];
      if (best) {
        if (best.d === 0) return pickup(a, best.spot);
        if (walk(a, best.tile)) {
          a.goal = { kind: 'forage', key: forageKey(best.spot) };
          a.bubble = { text: '❗', until: now + 900 };
          return;
        }
      }
    }
    // 隨便走走：4 格以內（跟班：主人身邊 2 格以內）
    const c = near ?? a.tile;
    const r = near ? 4 : 8;
    for (let i = 0; i < 8; i++) {
      const t = { x: c.x + Math.round((h.rng() - 0.5) * r), y: c.y + Math.round((h.rng() - 0.5) * r) };
      if (t.x < 0 || t.y < 0 || t.x >= m.width || t.y >= m.height || m.blocked[t.y * m.width + t.x]) continue;
      if (walk(a, t, 8)) return;
    }
    a.idleUntil = now + 1500 + h.rng() * 3500;
    if (h.rng() < 0.25) a.bubble = { text: p.hungry ? '🍖' : p.kind === 'cat' ? '💤' : '♪', until: now + 1600 };
  }

  function pickup(a: Actor, spot: ForageSpot) {
    const key = forageKey(spot);
    if (pickupPending.has(key)) return;
    pickupPending.add(key);
    a.hopUntil = performance.now() + 420;
    h.dogPickup(spot, a.id);
  }

  /** 跟班：走到主人身後（主人剛離開的那一格）；離太遠就跑快一點，再遠就直接出現在旁邊 */
  function follow(a: Actor, now: number, lead: { tile: TilePos; walking: boolean }) {
    const d = manhattan(a.tile, lead.tile);
    if (d > 12) {
      const back = trail.at(-2) ?? lead.tile;
      const f = feet(back);
      Object.assign(a, { tile: { ...back }, px: f.x, py: f.y, path: [], walking: false });
      return;
    }
    if (d <= 1) {
      if (!a.walking) a.idleUntil = now + 300;
      return;
    }
    const target = [...trail].reverse().find((t) => !same(t, lead.tile)) ?? lead.tile;
    const end = a.path.at(-1);
    if ((!a.walking || !end || !same(end, target)) && now - a.lastPlan > 250) {
      a.lastPlan = now;
      a.goal = null;
      if (!walk(a, target)) walk(a, lead.tile);
    }
  }

  function update(dt: number, now: number) {
    const g = h.game();
    if (!g) return;
    const here = petsHere();
    const ids = new Set(here.map((p) => p.id));
    for (const id of actors.keys()) if (!ids.has(id)) actors.delete(id);
    const lead = h.leader();
    if (lead && !same(trail.at(-1) ?? { x: -9, y: -9 }, lead.tile)) {
      trail.push({ ...lead.tile });
      if (trail.length > 6) trail.shift();
    }
    for (const p of here) {
      let a = actors.get(p.id);
      if (!a) actors.set(p.id, (a = spawnActor(p)));
      const sp = speciesOf(p.kind);
      const isCompanion = p.id === g.companion && !!lead;
      // 跟班：主人在走、或離太遠就跟上；主人停下來時就在附近自己玩（狗也會去撿附近的東西）
      const chasing = isCompanion && (lead!.walking || manhattan(a.tile, lead!.tile) > 3);
      if (chasing) follow(a, now, lead!);
      if (a.walking) {
        const next = a.path[0]!;
        const f = feet(next);
        const dx = f.x - a.px;
        const dy = f.y - a.py;
        const dist = Math.hypot(dx, dy);
        const hurry = isCompanion && lead && manhattan(a.tile, lead.tile) > 3 ? 1.6 : 1;
        const step = (sp?.speed ?? 2.5) * (p.hungry ? 0.6 : 1) * hurry * TS * dt;
        if (Math.abs(dx) > 0.3) a.right = dx > 0;
        if (dist <= step) {
          a.px = f.x;
          a.py = f.y;
          a.tile = next;
          a.path.shift();
          if (!a.path.length) {
            a.walking = false;
            a.idleUntil = now + 1200 + h.rng() * 3000;
            if (a.goal?.kind === 'forage') {
              const spot = forageHere().find((x) => forageKey(x.spot) === a!.goal!.key && same(x.tile, a!.tile));
              if (spot) pickup(a, spot.spot);
              a.goal = null;
            }
          }
        } else {
          a.px += (dx / dist) * step;
          a.py += (dy / dist) * step;
        }
      } else if (!chasing && now >= a.idleUntil) decide(a, p, now, isCompanion ? lead!.tile : null);
    }
    // 撿完（host 回來掉落物不見了）就清掉標記
    const left = new Set(g.forage.map(forageKey));
    for (const k of pickupPending) if (!left.has(k)) pickupPending.delete(k);
  }

  // ───────────── 繪製 ─────────────
  /** right = 往右走（或面向右）。emoji 本來面向左；走路圖看 sprite.faces */
  function drawSprite(sp: PetSpeciesDef | undefined, emoji: string, fx: number, fy: number, now: number, opts: { right?: boolean; hop?: number; seed: number; alpha?: number; walking?: boolean }) {
    const { ctx } = h;
    const { scale } = h.origin();
    const spr = sp?.sprite;
    const img = h.img(spr?.src);
    const sheet = spr?.sheet;
    const t = now / 1000;
    const float = spr?.float ? Math.sin(t * 2.4 + opts.seed) * 2 - 3 : 0;
    // 走路圖自己會動腳；靜態圖用一跳一跳代替
    const step = opts.walking && !sheet ? Math.abs(Math.sin(t * 12 + opts.seed)) * 1.5 : 0;
    const lift = (opts.hop ?? 0) + step - float;
    const faces = spr?.faces ?? (sheet ? 'right' : 'front');
    const mirror = img ? (faces === 'right' ? opts.right === false : faces === 'left' ? !!opts.right : false) : !!opts.right;
    if (!img) {
      h.shadow(fx, fy - 1, 8);
      h.emojiAt(emoji, fx, fy - 6 - lift, 11, mirror);
      return;
    }
    const k = spr?.scale ?? SCALE;
    const fw = sheet ? sheet.frameWidth : img.naturalWidth;
    const fh = sheet ? sheet.frameHeight : img.naturalHeight;
    const frame = sheet ? (opts.walking ? sheet.walk[Math.floor(t * sheet.fps + opts.seed) % sheet.walk.length]! : sheet.idle) : 0;
    const w = fw * k;
    const ht = fh * k;
    h.shadow(fx, fy - 1, Math.round(w * (float ? 0.45 : 0.6)));
    const breath = opts.walking && sheet ? 0 : Math.sin(t * 2.6 + opts.seed);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.translate(Math.round(fx * scale), Math.round((fy - lift) * scale));
    ctx.scale((mirror ? -1 : 1) * (1 - 0.015 * breath), 1 + 0.03 * breath);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, frame * fw, 0, fw, fh, (-w / 2) * scale, -ht * scale, w * scale, ht * scale);
    ctx.restore();
  }

  /** 地上的掉落物（在角色之前畫） */
  function drawGround(now: number) {
    const { ox, oy } = h.origin();
    const defs = h.defs();
    for (const { spot, tile } of forageHere()) {
      const it = defs?.items.get(spot.item);
      const cx = ox + tile.x * TS + TS / 2;
      const cy = oy + tile.y * TS + TS / 2;
      const bob = Math.round(Math.sin(now / 300 + tile.x) * 1);
      h.shadow(cx, cy + 4, 6);
      if (h.itemAt) h.itemAt(spot.item, it?.emoji ?? '❔', cx, cy - bob, 10);
      else h.emojiAt(it?.emoji ?? '❔', cx, cy - bob, 10);
      if (Math.floor(now / 700 + tile.y) % 5 === 0) h.emojiAt('✨', cx + 5, cy - 6, 6);
    }
  }

  /** 寵物和野生寵物；front = 畫在她前面（y 比她大）的那一半 */
  function draw(now: number, splitY: number, front: boolean) {
    const g = h.game();
    if (!g) return;
    const { ox, oy } = h.origin();
    const items: { y: number; draw: () => void }[] = [];
    for (const p of petsHere()) {
      const a = actors.get(p.id);
      if (!a) continue;
      const sp = speciesOf(p.kind);
      items.push({
        y: a.py,
        draw: () => {
          const hop = a.hopUntil > now ? Math.sin((1 - (a.hopUntil - now) / 420) * Math.PI) * 3 : 0;
          drawSprite(sp, p.emoji, ox + a.px, oy + a.py, now, { right: a.right, hop, seed: a.id, walking: a.walking });
          if (a.bubble && a.bubble.until > now) h.emojiAt(a.bubble.text, ox + a.px + 6, oy + a.py - 18, 8);
          if (p.id === g.companion) h.emojiAt('⭐', ox + a.px - 7, oy + a.py - 16, 6);
        },
      });
    }
    for (const { spawn, tile } of wildHere()) {
      const f = feet(tile);
      const sp = speciesOf(spawn.kind);
      items.push({
        y: f.y,
        draw: () => {
          const seed = hashSeed(spawn.id) % 100;
          drawSprite(sp, sp?.emoji ?? '❔', ox + f.x, oy + f.y, now, { seed, alpha: 0.95 });
          const net = throwing.get(spawn.id) ?? 0;
          if (net > now) {
            const k = 1 - (net - now) / 1100;
            const shake = Math.sin(k * 30) * 2 * (1 - k);
            h.emojiAt('🥅', ox + f.x + shake, oy + f.y - 8 - Math.max(0, (0.25 - k) * 40), 13);
          } else if (Math.floor(now / 500) % 2 === 0) h.emojiAt('✨', ox + f.x + 7, oy + f.y - 16, 7);
        },
      });
    }
    for (const x of items) if ((x.y > splitY) === front) x.draw();
  }

  // ───────────── 點擊 ─────────────
  function petAt(lx: number, ly: number): PetView | undefined {
    const here = petsHere();
    for (const p of here) {
      const a = actors.get(p.id);
      if (a && Math.abs(lx - a.px) <= 8 && ly <= a.py + 2 && ly >= a.py - 16) return p;
    }
    return undefined;
  }
  function wildAtTile(tx: number, ty: number): WildSpawn | undefined {
    return wildHere().find(({ tile }) => tile.x === tx && (tile.y === ty || tile.y - 1 === ty))?.spawn;
  }
  function forageAt(tile: TilePos): ForageSpot | undefined {
    return forageHere().find((f) => same(f.tile, tile))?.spot;
  }
  function wildTile(id: string): TilePos | undefined {
    return wildHere().find((w) => w.spawn.id === id)?.tile;
  }
  function throwNet(id: string) {
    throwing.set(id, performance.now() + 1100);
  }
  function hop(petId: number, text?: string) {
    const a = actors.get(petId);
    if (!a) return;
    a.hopUntil = performance.now() + 420;
    if (text) a.bubble = { text, until: performance.now() + 1500 };
  }
  function resetScene() {
    actors.clear();
    trail.length = 0;
    placeCache = null;
  }
  function debug() {
    return {
      pets: [...actors.values()].map((a) => ({ id: a.id, kind: a.kind, tile: { ...a.tile }, walking: a.walking, goal: a.goal?.kind ?? null })),
      forage: forageHere().map((f) => ({ key: forageKey(f.spot), item: f.spot.item, tile: f.tile })),
      wild: wildHere().map((w) => ({ id: w.spawn.id, kind: w.spawn.kind, tile: w.tile })),
    };
  }
  return { update, drawGround, draw, petAt, wildAtTile, forageAt, wildTile, throwNet, hop, resetScene, debug };
}
export type PetLayer = ReturnType<typeof createPetLayer>;
