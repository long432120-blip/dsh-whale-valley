// 純函數：依「觸發時機 × 場景 × 時段」從台詞池挑一句。
import type { DayPhase, LineDef, LineTrigger, SceneId } from './types.ts';

export interface LineContext {
  trigger: LineTrigger;
  sceneId: SceneId;
  phase: DayPhase;
  /** V0.2：跟哪個物品有關（餵食、釣到、收成） */
  item?: string;
  category?: string;
  tags?: string[];
  /** 目前好感；台詞的 minAffection 用這個判斷是否解鎖 */
  affection?: number;
}

export function matchLines(lines: LineDef[], ctx: LineContext): LineDef[] {
  return lines.filter(
    (l) =>
      (l.on ?? ['click']).includes(ctx.trigger) &&
      (!l.scenes || l.scenes.includes(ctx.sceneId)) &&
      (!l.phases || l.phases.includes(ctx.phase)) &&
      (!l.items || (ctx.item !== undefined && l.items.includes(ctx.item))) &&
      (!l.categories || (ctx.category !== undefined && l.categories.includes(ctx.category))) &&
      (!l.tags || l.tags.every((t) => ctx.tags?.includes(t))) &&
      (l.minAffection ?? 0) <= (ctx.affection ?? 0),
  );
}

/** 越具體越優先：指定物品 > 指定標籤 > 指定分類；場景、時段不算（保留原本的隨機感） */
const specificity = (l: LineDef) => (l.items ? 8 : 0) + (l.tags ? 4 : 0) + (l.categories ? 2 : 0);

/**
 * 加權隨機，並避開上一句（池子只有一句時例外）。
 * rng 由外部注入，測試時可以固定。
 */
export function pickLine(
  lines: LineDef[],
  ctx: LineContext,
  rng: () => number = Math.random,
  lastText?: string,
): string | null {
  return pickLineDef(lines, ctx, rng, lastText)?.text ?? null;
}

/** 同 pickLine，但回傳整筆台詞（像素版要用到 action） */
export function pickLineDef(
  lines: LineDef[],
  ctx: LineContext,
  rng: () => number = Math.random,
  lastText?: string,
): LineDef | null {
  let pool = matchLines(lines, ctx);
  if (pool.length) {
    const top = Math.max(...pool.map(specificity));
    pool = pool.filter((l) => specificity(l) === top);
  }
  if (pool.length > 1 && lastText) pool = pool.filter((l) => l.text !== lastText);
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, l) => sum + (l.weight ?? 1), 0);
  let r = rng() * total;
  for (const l of pool) {
    r -= l.weight ?? 1;
    if (r < 0) return l;
  }
  return pool[pool.length - 1]!;
}
