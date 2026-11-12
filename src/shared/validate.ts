// 角色包檢查：網友換圖換字後跑 `npm run check:pack`，錯在哪一行一目了然。
import type { CharacterFile, ScenesFile } from './types.ts';

export function validatePack(scenes: ScenesFile, ch: CharacterFile): string[] {
  const errs: string[] = [];
  const inPct = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 100;
  const ids = new Set<string>();

  if (scenes.version !== 1) errs.push('scenes.json：version 必須是 1');
  for (const s of scenes.scenes ?? []) {
    const at = `scenes.json › ${s.id}`;
    if (ids.has(s.id)) errs.push(`${at}：場景 id 重複`);
    ids.add(s.id);
    if (!s.background) errs.push(`${at}：缺少 background`);
    const w = s.walkArea;
    if (!w || !inPct(w.xMin) || !inPct(w.xMax) || !inPct(w.groundY) || w.xMin >= w.xMax) {
      errs.push(`${at}：walkArea 要有 0–100 的 xMin < xMax 與 groundY`);
    }
    if (typeof s.spawns?.default !== 'number') errs.push(`${at}：spawns 必須有 default`);
    for (const [k, v] of Object.entries(s.spawns ?? {})) {
      if (w && (v < w.xMin || v > w.xMax)) errs.push(`${at}：spawns.${k}=${v} 不在可行走範圍內（會被夾回範圍）`);
    }
    for (const h of s.hotspots ?? []) {
      const r = h.rect;
      if (!r || ![r.x, r.y, r.w, r.h].every(inPct) || r.x + r.w > 100 || r.y + r.h > 100) {
        errs.push(`${at} › ${h.id}：rect 超出舞台`);
      }
    }
  }
  if (!ids.has(scenes.initialScene)) errs.push(`scenes.json：initialScene「${scenes.initialScene}」不存在`);
  for (const s of scenes.scenes ?? []) {
    for (const h of s.hotspots ?? []) {
      const target = scenes.scenes.find((t) => t.id === h.action?.scene);
      if (!target) errs.push(`scenes.json › ${s.id} › ${h.id}：目標場景「${h.action?.scene}」不存在`);
      else if (h.action.spawn && !(h.action.spawn in target.spawns)) {
        errs.push(`scenes.json › ${s.id} › ${h.id}：目標場景沒有 spawn「${h.action.spawn}」`);
      }
    }
  }

  if (ch.version !== 1) errs.push('character.json：version 必須是 1');
  for (const [k, sp] of Object.entries(ch.sprites ?? {})) {
    if (!sp?.src) errs.push(`character.json › sprites.${k}：缺少 src`);
    const f = sp?.frames ?? 1;
    if (!Number.isInteger(f) || f < 1) errs.push(`character.json › sprites.${k}：frames 要是正整數`);
    if (f > 1 && !(sp.fps && sp.fps > 0)) errs.push(`character.json › sprites.${k}：多幀時 fps 要 > 0`);
  }
  if (!ch.sprites?.idle) errs.push('character.json：至少要有 sprites.idle');
  if (!(ch.heightPct > 0 && ch.heightPct <= 100)) errs.push('character.json：heightPct 要在 1–100');
  if (!(ch.speed > 0)) errs.push('character.json：speed 要 > 0');
  if (!Array.isArray(ch.idleMs) || ch.idleMs[0] > ch.idleMs[1]) errs.push('character.json：idleMs 要是 [最短, 最長]');
  const fallback = (ch.lines ?? []).some(
    (l) => (l.on ?? ['click']).includes('click') && !l.scenes && !l.phases,
  );
  if (!fallback) errs.push('character.json：至少要有一句「不限場景、不限時段」的 click 台詞當保底');
  for (const l of ch.lines ?? []) {
    for (const sid of l.scenes ?? []) if (!ids.has(sid)) errs.push(`character.json：台詞「${l.text}」指定了不存在的場景 ${sid}`);
  }
  return errs;
}
