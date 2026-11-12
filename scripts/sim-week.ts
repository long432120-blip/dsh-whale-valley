// V0.18：7 天數值模擬。用規則層（跟 host 同一套）模擬三種玩家各玩 7 天，看金幣、體力、飽食、好感的曲線合不合理。
//   npx tsx scripts/sim-week.ts            → 印出表格
//   npx tsx scripts/sim-week.ts --json     → 印出 JSON（給測試或畫圖用）
//   npx tsx scripts/sim-week.ts --days 40  → 模擬更多天（看好感什麼時候到求婚）
// 三種玩家：
//   casual  每天上線一下：釣幾次魚、餵她、摸頭、睡覺
//   farmer  認真種田：澆水、收成、賣菜、補種子，再釣魚
//   gambler 什麼都做，晚上去酒館猜硬幣、玩牌、吃零食、開冰箱、完成願望
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGameplay } from '../src/shared/gameplay-pack.ts';
import { applyAction, buildDefs, gameView, newGame, seasonAt, tickGame } from '../src/shared/gameplay.ts';
import type { GameAction, GameplayDefs, GameState } from '../src/shared/gameplay-types.ts';

const PACK = join(import.meta.dirname, '..', 'packs', 'whale-girl-pixel');
const file = (await loadGameplay(async (n) => JSON.parse(await readFile(join(PACK, n), 'utf8')).valueOf()))!;
const defs = buildDefs(file);
const HOUR = 3_600_000;
const PLOTS = ['garden/plot-1', 'garden/plot-2', 'garden/plot-3', 'garden/plot-4', 'garden/plot-5'];

type Style = 'casual' | 'farmer' | 'gambler';
interface DayRow {
  day: number;
  season: string;
  coins: number;
  earned: number;
  spent: number;
  affection: number;
  level: string;
  staminaLeftAtNight: number;
  minSatiety: number;
  fishCaught: number;
  harvested: number;
  wish: string;
  wishDone: boolean;
  actionsFailed: Record<string, number>;
  /** 金幣從哪裡來（動作種類 → 金幣） */
  earnBy: Record<string, number>;
  /** 好感從哪裡來 */
  loveBy: Record<string, number>;
  diary: string;
}

const argDays = process.argv.indexOf('--days');
const DAYS = argDays > 0 ? Math.max(1, Number(process.argv[argDays + 1]) || 7) : 7;

function simulate(style: Style, start: number, seed = 7, days = DAYS): DayRow[] {
  let g: GameState = newGame(start, defs, seed);
  // 新手教學做完（模擬的是之後的日常）：拿到教學的獎勵
  let inv = g.inventory;
  for (const c of file.quests?.chains ?? []) for (const st of c.steps) for (const [id, n] of Object.entries(st.reward ?? {})) inv = { ...inv, [id]: (inv[id] ?? 0) + n };
  g = { ...g, inventory: inv, quest: { ...g.quest, chain: null, done: { tutorial: true, 'town-life': true } } };
  const rows: DayRow[] = [];
  let t = start;
  for (let day = 1; day <= days; day++) {
    const failed: Record<string, number> = {};
    let earned = 0;
    let spent = 0;
    let fishCaught = 0;
    let harvested = 0;
    let minSatiety = Infinity;
    const earnBy: Record<string, number> = {};
    const loveBy: Record<string, number> = {};
    const coins = () => g.inventory.coin ?? 0;
    const doAct = (a: GameAction, dt = 10 * 60_000): boolean => {
      t += dt;
      const before = coins();
      const love0 = g.affection;
      const r = applyAction(g, a, defs, t);
      const prevWishDone = g.wish?.done;
      g = r.game;
      if (g.satiety < minSatiety && process.env.TRACE) console.log(`   [${style} d${day}] ${new Date(t).toTimeString().slice(0, 5)} ${a.type} → 飽食 ${Math.round(g.satiety)} 體力 ${Math.round(g.stamina)} ${r.ok ? '' : r.error}`);
      minSatiety = Math.min(minSatiety, g.satiety);
      const diff = coins() - before;
      const love = r.game.affection - love0;
      if (r.ok && love > 0) {
        const wishNow = r.game.wish?.done && !prevWishDone;
        const key = wishNow ? 'wish' : a.type;
        loveBy[key] = (loveBy[key] ?? 0) + love;
      }
      if (diff > 0) {
        earned += diff;
        earnBy[a.type] = (earnBy[a.type] ?? 0) + diff;
      }
      else spent -= diff;
      if (!r.ok) {
        failed[`${a.type}:${r.error}`] = (failed[`${a.type}:${r.error}`] ?? 0) + 1;
        return false;
      }
      if (r.event.type === 'caught') fishCaught += r.event.count;
      if (r.event.type === 'harvested') harvested += r.event.count;
      return true;
    };
    const feedCheapest = () => {
      const foods = Object.entries(g.inventory).filter(([id, n]) => n > 0 && defs.items.get(id)?.food).sort((a, b) => (defs.items.get(a[0])!.price ?? 0) - (defs.items.get(b[0])!.price ?? 0));
      if (foods.length) return doAct({ type: 'feed', item: foods[0]![0] }, 60_000);
      return doAct({ type: 'drink', table: 'pond' }, 60_000); // 沒有吃的：去池塘喝水
    };
    const sellFish = (keep: number) => {
      for (const [id, n] of Object.entries(g.inventory)) {
        if (n > keep && id.startsWith('fish_')) doAct({ type: 'sell', item: id, count: n - keep, shop: 'fishmonger' }, 60_000);
      }
    };
    const season = seasonAt(t, defs)?.id ?? '';
    // ── 早上 7 點 ──
    t = Math.max(t, dayStartAt(t) + 7 * HOUR);
    g = tickGame(g, t, defs);
    const wish = g.wish;
    // 摸頭（每個人都會）
    for (let i = 0; i < 3; i++) doAct({ type: 'headpat' }, 30_000);
    if (style !== 'casual') {
      // 田：收成 → 澆水 → 補種
      for (const p of PLOTS) if (g.plots[p] && gameView(g, defs, t).plots[p]?.ready) doAct({ type: 'harvest', plot: p }, 2 * 60_000);
      for (const p of PLOTS) if (g.plots[p]) doAct({ type: 'water', plot: p }, 2 * 60_000);
      const seedTrade = file.shops.florist!.trades.find((tr) => !tr.seasons || tr.seasons.includes(season));
      for (const p of PLOTS) {
        if (g.plots[p]) continue;
        const seed = Object.keys(seedTrade?.get ?? {})[0];
        if (!seed) break;
        if ((g.inventory[seed] ?? 0) <= 0 && seedTrade && coins() >= (seedTrade.give.coin ?? 0) + 30) doAct({ type: 'trade', shop: 'florist', trade: seedTrade.id }, 60_000);
        if ((g.inventory[seed] ?? 0) > 0) doAct({ type: 'plant', plot: p, seed }, 2 * 60_000);
        if (g.plots[p]) doAct({ type: 'water', plot: p }, 60_000);
      }
      // 賣收成（留 2 個給她吃）
      for (const [id, n] of Object.entries(g.inventory)) if (n > 2 && id.startsWith('crop_')) doAct({ type: 'sell', item: id, count: n - 2 }, 60_000);
    }
    // ── 釣魚：casual 釣 3 次；其他釣到體力剩 30% ──
    const tries = style === 'casual' ? 3 : 20;
    for (let i = 0; i < tries; i++) {
      if (g.satiety < 35) feedCheapest();
      if (g.stamina < (style === 'casual' ? 0 : 30)) break;
      doAct({ type: 'fish', table: 'pond' }, 15 * 60_000);
    }
    sellFish(style === 'casual' ? 3 : 2);
    // 一天只上線一次的人：走之前把她餵飽（不然隔天早上會餓）
    for (let i = 0; i < 5 && g.satiety < (style === 'casual' ? 90 : 60); i++) if (!feedCheapest()) break;
    // ── 下午：願望（簡單的就做） ──
    if (g.wish && !g.wish.done) {
      const w = g.wish;
      if (w.event === 'fed' && w.item) {
        if ((g.inventory[w.item] ?? 0) <= 0) {
          const tr = Object.values(file.shops).flatMap((s, i) => s.trades.map((x) => ({ shop: Object.keys(file.shops)[i]!, x }))).find(({ x }) => x.get[w.item!]);
          if (tr && coins() >= (tr.x.give.coin ?? 0)) doAct({ type: 'trade', shop: tr.shop, trade: tr.x.id }, 5 * 60_000);
        }
        if ((g.inventory[w.item] ?? 0) > 0) doAct({ type: 'feed', item: w.item }, 60_000);
      }
      if (w.event === 'bathed') doAct({ type: 'bath' }, 30 * 60_000);
      if (w.event === 'talked' && w.npc) doAct({ type: 'talk', npc: w.npc }, 5 * 60_000);
    }
    if (style !== 'casual') doAct({ type: 'bath' }, 30 * 60_000);
    // ── 晚上：酒館 ──
    if (style === 'gambler') {
      t = Math.max(t, dayStartAt(t) + 20 * HOUR);
      for (let i = 0; i < 6 && coins() >= 40; i++) doAct({ type: 'coin_flip', guess: i % 2 ? 'heads' : 'tails' }, 3 * 60_000);
      for (const npc of ['fisher', 'smith', 'florist']) doAct({ type: 'cards', npc }, 5 * 60_000);
      for (let i = 0; i < 3; i++) doAct({ type: 'snack', table: 'snack' }, 10 * 60_000);
      doAct({ type: 'fridge' }, 2 * 60_000);
    }
    // ── 晚上 21 點：睡前再看一下 ──
    if (style !== 'casual') {
      t = Math.max(t, dayStartAt(t) + 21 * HOUR);
      g = tickGame(g, t, defs);
      for (let i = 0; i < 5 && g.satiety < 60; i++) if (!feedCheapest()) break;
    }
    // ── 22 點睡覺 ──
    t = Math.max(t, dayStartAt(t) + 22 * HOUR);
    const staminaLeftAtNight = Math.round(g.stamina);
    const wishDone = !!g.wish?.done;
    const before = coins();
    const s = applyAction(g, { type: 'sleep' }, defs, t);
    if (process.env.TRACE) console.log(`   [${style} d${day}] sleep ${new Date(t).toString().slice(0, 21)} 飽食 ${Math.round(g.satiety)} → ${Math.round(s.game.satiety)}；起床 ${s.ok && s.event.type === 'slept' ? new Date(s.event.to).toString().slice(0, 21) : '?'}`);
    g = s.game;
    if (s.ok && s.event.type === 'slept') t = s.event.to;
    void before;
    const v = gameView(g, defs, t);
    rows.push({
      day, season, coins: coins(), earned, spent, affection: Math.round(g.affection), level: v.level,
      staminaLeftAtNight, minSatiety: Math.round(minSatiety), fishCaught, harvested,
      wish: wish ? `${wish.emoji}${wish.text}` : '—', wishDone, actionsFailed: failed, earnBy, loveBy,
      diary: v.diary.entries[0]?.text ?? '',
    });
  }
  return rows;
}

function dayStartAt(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 從春天第 1 天開始
let START = new Date(2026, 2, 2, 7, 0).getTime();
for (let i = 0; i < 40 && !(seasonAt(START, defs)?.id === 'spring' && seasonAt(START, defs)?.day === 1); i++) START += 24 * HOUR;
const out: Record<Style, DayRow[]> = {
  casual: simulate('casual', START),
  farmer: simulate('farmer', START),
  gambler: simulate('gambler', START),
};
// 每種玩家：第幾天升到哪一級、第幾天可以求婚
const milestones = Object.fromEntries(Object.entries(out).map(([style, rows]) => {
  const m: Record<string, number> = {};
  for (const r of rows) if (!(r.level in m)) m[r.level] = r.day;
  const propose = rows.find((r) => r.affection >= (file.marriage?.minAffection ?? Infinity))?.day ?? null;
  return [style, { levels: m, propose }];
}));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ milestones, days: out }, null, 2));
} else if (DAYS > 14) {
  console.log(`模擬 ${DAYS} 天：第幾天升到哪一級（求婚要 ${file.marriage?.minAffection} 好感）`);
  for (const [style, m] of Object.entries(milestones)) {
    console.log(`  ${style.padEnd(8)} ${Object.entries(m.levels).map(([k, d]) => `${k} 第${d}天`).join('、')}｜可以求婚：${m.propose ? `第 ${m.propose} 天` : `${DAYS} 天內還不行`}`);
  }
} else {
  for (const [style, rows] of Object.entries(out)) {
    console.log(`\n=== ${style} ===`);
    console.log('天 季節  金幣  賺   花   好感 等級      睡前體力 最低飽食 魚 收成 願望');
    for (const r of rows) {
      console.log(`${r.day}  ${r.season.padEnd(6)} ${String(r.coins).padStart(5)} ${String(r.earned).padStart(4)} ${String(r.spent).padStart(4)} ${String(r.affection).padStart(4)} ${r.level.padEnd(8)} ${String(r.staminaLeftAtNight).padStart(4)} ${String(r.minSatiety).padStart(6)} ${String(r.fishCaught).padStart(3)} ${String(r.harvested).padStart(3)}  ${r.wishDone ? '✅' : '⬜'} ${r.wish}`);
      const f = Object.entries(r.actionsFailed).map(([k, n]) => `${k}×${n}`).join(' ');
      if (f) console.log(`     失敗：${f}`);
      console.log(`     金幣來源：${Object.entries(r.earnBy).map(([k, n]) => `${k} ${n}`).join('、') || '—'}｜好感來源：${Object.entries(r.loveBy).map(([k, n]) => `${k} ${Math.round(n)}`).join('、') || '—'}`);
      console.log(`     日記：${r.diary}`);
    }
  }
}
export { simulate };
export type { GameplayDefs };
