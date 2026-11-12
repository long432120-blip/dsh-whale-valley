// 像素角色包檢查：地圖畫完、改完 JSON 就跑一次 `npm run check:pixel`。
// 會抓：門通到不存在的場景、出生點卡在牆裡、地點走不到、作息寫錯名字……
import { validateClockHud } from './clock-hud.ts';
import type { GameplayFile } from './gameplay-types.ts';
import { reachable } from './path.ts';
import type { MapModel, PixelCharacterFile, PixelWorldFile, TilePos } from './pixel-types.ts';
import { isWalkable } from './tiled.ts';

export function validatePixelPack(
  world: PixelWorldFile,
  ch: PixelCharacterFile,
  maps: Record<string, MapModel>,
  gameplay?: GameplayFile | null,
): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const fmt = (t: TilePos) => `(${t.x},${t.y})`;

  if (world.version !== 2) errs.push('scenes.json：version 必須是 2');
  if (world.hud?.clock) errs.push(...validateClockHud(world.hud.clock)); // V0.16
  // V0.18：季節粒子、深夜提醒
  const fxDefs = [
    ...Object.entries(world.ambient?.seasons ?? {}).map(([id, sp]) => [`seasons.${id}`, sp] as const),
    ...Object.entries(world.ambient?.weather ?? {}).map(([id, sp]) => [`weather.${id}`, sp] as const),
  ];
  for (const [id, sp] of fxDefs) {
    const at = `scenes.json：ambient.${id}`;
    if (!['petal', 'firefly', 'leaf', 'snow'].includes(sp.kind)) errs.push(`${at} 的 kind 要是 petal、firefly、leaf、snow`);
    if (!sp.colors?.length) errs.push(`${at} 至少要一個顏色`);
    if (!(sp.count >= 0 && sp.count <= 200)) errs.push(`${at} 的 count 要在 0～200`);
    for (const k of ['size', 'fall', 'sway'] as const) if (!Array.isArray(sp[k]) || sp[k].length !== 2 || sp[k][0] > sp[k][1]) errs.push(`${at} 的 ${k} 要是 [最小, 最大]`);
  }
  const ln = world.ambient?.lateNight;
  if (ln && (!(ln.fromHour >= 0 && ln.fromHour <= 23) || !(ln.toHour >= 0 && ln.toHour <= 23) || !(ln.repeatMinutes > 0) || !(ln.maxPerNight >= 1) || !ln.lines?.length)) {
    errs.push('scenes.json：ambient.lateNight 要有 fromHour、toHour（0～23）、repeatMinutes、maxPerNight、lines');
  }
  for (const s of world.scenes ?? []) {
    if (ids.has(s.id)) errs.push(`scenes.json：場景 id「${s.id}」重複`);
    ids.add(s.id);
  }
  if (!ids.has(world.initialScene)) errs.push(`scenes.json：initialScene「${world.initialScene}」不存在`);

  for (const s of world.scenes ?? []) {
    const m = maps[s.id];
    const at = s.map ?? `場景 ${s.id}`;
    if (!m) { errs.push(`${at}：讀不到地圖`); continue; }
    if (m.tileSize !== world.tileSize) errs.push(`${at}：圖塊大小 ${m.tileSize} 跟 scenes.json 的 ${world.tileSize} 不一致`);
    if (m.width > world.viewport.tilesX || m.height > world.viewport.tilesY) {
      errs.push(`${at}：地圖 ${m.width}×${m.height} 比畫面 ${world.viewport.tilesX}×${world.viewport.tilesY} 大（V0.2 還沒有鏡頭捲動）`);
    }
    const start = m.spawns.default;
    if (!start) { errs.push(`${at}：缺少名為 default 的 spawn`); continue; }
    if (!isWalkable(m, start.tile)) errs.push(`${at}：spawn default ${fmt(start.tile)} 站在不能走的格子上`);
    const canReach = reachable(m, start.tile);
    const ok = (t: TilePos) => isWalkable(m, t) && canReach[t.y * m.width + t.x];

    for (const [name, sp] of Object.entries(m.spawns)) {
      if (!ok(sp.tile)) errs.push(`${at}：spawn ${name} ${fmt(sp.tile)} 不能走，或從 default 走不到`);
    }
    for (const d of m.doors) {
      if (!d.to) errs.push(`${at} › ${d.id}：門缺少 to 屬性`);
      else if (!ids.has(d.to)) errs.push(`${at} › ${d.id}：通往不存在的場景「${d.to}」`);
      else if (d.spawn && maps[d.to] && !maps[d.to]!.spawns[d.spawn]) errs.push(`${at} › ${d.id}：目標場景沒有 spawn「${d.spawn}」`);
      if (!d.stand) errs.push(`${at} › ${d.id}：門的範圍裡沒有可以站的格子（範圍要包含門前那一格）`);
      else if (!ok(d.stand)) errs.push(`${at} › ${d.id}：門口 ${fmt(d.stand)} 從 default 走不到`);
    }
    const seen = new Set<string>();
    for (const it of m.interactables ?? []) {
      if (seen.has(it.id)) errs.push(`${at}：互動物件名稱「${it.id}」重複（農田要用不同名字，例如 plot-1、plot-2）`);
      seen.add(it.id);
      if (it.hotspot?.approach !== 'none' && !it.stands.some(ok)) // V0.9：原地觸發的熱區不用站位
        errs.push(`${at} › ${it.id}：旁邊沒有走得到的格子，她沒辦法過去操作`);
      if (it.kind === 'fishing') {
        if (!it.table) errs.push(`${at} › ${it.id}：釣魚區缺少 table 屬性`);
        else if (gameplay && !gameplay.fishing.tables[it.table]) errs.push(`${at} › ${it.id}：gameplay.json 沒有掉落表「${it.table}」`);
      }
      if (it.kind === 'shop') {
        if (!it.shop) errs.push(`${at} › ${it.id}：商人缺少 shop 屬性`);
        else if (gameplay && !gameplay.shops[it.shop]) errs.push(`${at} › ${it.id}：gameplay.json 沒有商人「${it.shop}」`);
      }
      const need = (k: 'machine' | 'building' | 'npc', where: Record<string, unknown> | undefined, what: string) => {
        if (it.kind !== k) return;
        const v = it[k];
        if (!v) errs.push(`${at} › ${it.id}：${what}缺少 ${k} 屬性`);
        else if (gameplay && !where?.[v]) errs.push(`${at} › ${it.id}：gameplay.json 沒有${what}「${v}」`);
      };
      need('machine', gameplay?.machines, '機器');
      need('building', gameplay?.buildings, '建築');
      need('npc', gameplay?.npcs, '居民');
      if (it.unlock && gameplay && !gameplay.unlocks?.[it.unlock]) errs.push(`${at} › ${it.id}：gameplay.json 沒有解鎖項目「${it.unlock}」`);
    }
    for (const d of m.doors) {
      if (d.unlock && gameplay && !gameplay.unlocks?.[d.unlock]) errs.push(`${at} › ${d.id}：gameplay.json 沒有解鎖項目「${d.unlock}」`);
    }
    for (const ar of m.areas ?? []) {
      if (ar.kind === 'pen' && gameplay && (!ar.building || !gameplay.buildings?.[ar.building])) errs.push(`${at} › ${ar.name}：圍欄的 building 不存在`);
    }
    for (const sp of Object.values(m.spots)) {
      if (!ok(sp.tile)) errs.push(`${at}：地點 ${sp.name} ${fmt(sp.tile)} 不能走，或從 default 走不到`);
      if (sp.emote && !ch.emotes?.names.includes(sp.emote)) errs.push(`${at}：地點 ${sp.name} 用了沒定義的表情「${sp.emote}」`);
    }
  }

  if (ch.version !== 2) errs.push('character.json：version 必須是 2');
  const w = ch.world;
  if (!w?.src) errs.push('character.json：缺少 world.src');
  else {
    for (const f of ['down', 'left', 'right', 'up'] as const) {
      if (typeof w.rows?.[f] !== 'number') errs.push(`character.json：world.rows 缺少 ${f}`);
    }
    if (!w.walk?.length) errs.push('character.json：world.walk 至少要一幀');
    if (w.walkBob && w.walkBob.length !== w.walk.length) errs.push('character.json：world.walkBob 長度要跟 walk 一樣');
    if (!(w.fps > 0)) errs.push('character.json：world.fps 要 > 0');
    if (!(w.footY > 0 && w.footY <= w.frameHeight)) errs.push('character.json：world.footY 要在 1 到 frameHeight 之間');
    if (w.drawScale !== undefined && !(w.drawScale > 0 && w.drawScale <= 4)) errs.push('character.json：world.drawScale 要在 0 到 4 之間');
  }
  const clips = ch.actions?.clips ?? {};
  if (ch.actions) {
    const a = ch.actions;
    if (!a.src) errs.push('character.json：缺少 actions.src');
    if (!(a.footY > 0 && a.footY <= a.frameHeight)) errs.push('character.json：actions.footY 要在 1 到 frameHeight 之間');
    for (const [name, c] of Object.entries(clips)) {
      if (!Number.isInteger(c.row) || c.row < 0) errs.push(`character.json：動作 ${name} 的 row 要是 0 以上的整數`);
      if (!c.frames?.length || c.frames.some((f) => !Number.isInteger(f) || f < 0)) errs.push(`character.json：動作 ${name} 的 frames 要是 0 以上的整數`);
      if (!(c.fps > 0)) errs.push(`character.json：動作 ${name} 的 fps 要 > 0`);
      if (c.loop !== undefined && !(c.loop >= 0 && c.loop < (c.frames?.length ?? 0))) errs.push(`character.json：動作 ${name} 的 loop 超出 frames 範圍`);
      if (c.sheet && (!c.sheet.src || !(c.sheet.frameWidth > 0) || !(c.sheet.frameHeight > 0) || !(c.sheet.footY > 0 && c.sheet.footY <= c.sheet.frameHeight))) {
        errs.push(`character.json：動作 ${name} 的 sheet 要有 src、frameWidth、frameHeight，footY 要在 1 到 frameHeight 之間`);
      }
    }
    if (a.onClick && !clips[a.onClick]) errs.push(`character.json：actions.onClick 指定了不存在的動作「${a.onClick}」`);
  }
  for (const l of ch.lines ?? []) {
    if (l.action && !clips[l.action]) errs.push(`character.json：台詞「${l.text}」指定了不存在的動作「${l.action}」`);
  }
  for (const [id, m] of Object.entries(maps)) {
    for (const sp of Object.values(m.spots)) {
      if (sp.action && !clips[sp.action]) errs.push(`${id} 地圖：地點 ${sp.name} 指定了不存在的動作「${sp.action}」`);
    }
  }
  if (!(ch.speed > 0)) errs.push('character.json：speed 要 > 0（每秒幾格）');
  if (!Array.isArray(ch.idleMs) || ch.idleMs[0] > ch.idleMs[1]) errs.push('character.json：idleMs 要是 [最短, 最長]');
  for (const [phase, plan] of Object.entries(ch.schedule ?? {})) {
    if (!plan) continue;
    const m = maps[plan.scene];
    if (!m) { errs.push(`character.json：schedule.${phase} 的場景「${plan.scene}」不存在`); continue; }
    for (const n of plan.spots) if (!m.spots[n]) errs.push(`character.json：schedule.${phase} 的地點「${n}」不在 ${plan.scene} 地圖裡`);
  }
  const fallback = (ch.lines ?? []).some(
    (l) => (l.on ?? ['click']).includes('click') && !l.scenes && !l.phases && !l.minAffection && !l.items && !l.categories && !l.tags,
  );
  if (!fallback) errs.push('character.json：至少要有一句「不限場景、不限時段、不用好感解鎖」的 click 台詞當保底');
  const triggers = new Set(['click', 'enter', 'welcome', 'feed', 'full', 'levelup', 'tired', 'caught', 'harvest', 'no_seed', 'trade', 'festival', 'married', 'mine_go', 'mine_back', 'help']);
  const itemIds = new Set(gameplay?.items.map((i) => i.id));
  for (const l of ch.lines ?? []) {
    for (const sid of l.scenes ?? []) if (!ids.has(sid)) errs.push(`character.json：台詞「${l.text}」指定了不存在的場景 ${sid}`);
    for (const t of l.on ?? []) if (!triggers.has(t)) errs.push(`character.json：台詞「${l.text}」的 on 有不認得的時機「${t}」`);
    if (gameplay) for (const id of l.items ?? []) if (!itemIds.has(id)) errs.push(`character.json：台詞「${l.text}」指定了 gameplay.json 沒有的物品 ${id}`);
    if (l.minAffection !== undefined && !(l.minAffection >= 0)) errs.push(`character.json：台詞「${l.text}」的 minAffection 要 ≥ 0`);
  }
  return errs;
}
