// V0.16：坐下來吃飯、零食桌、冰箱。
// 純畫面：吃東西（feed）、吃零食（snack）、從冰箱找東西（fridge）都交給呼叫的人送 host；這裡只決定長什麼樣子。
import type { ItemId } from '../../shared/gameplay-types.ts';
import { button, el } from './ui-panels-v4.ts';
import { slotIcon } from './ui-panels.ts';

/** 揹包裡一樣能吃的東西 */
export interface FoodRow {
  id: ItemId;
  name: string;
  emoji: string;
  count: number;
  satiety: number;
  affection: number;
  /** 她特別喜歡（好感 ×2） */
  liked: boolean;
}

/** 一張點心桌今天的狀態 */
export interface SnackRow {
  name: string;
  emoji: string;
  left: number;
  perDay: number;
  satiety: number;
  affection: number;
}

/** 冰箱打開後的狀態：find = 剛剛找到的東西（null = 今天找過了）；undefined = 還在開門 */
export interface FridgeState {
  opening: boolean;
  /** 剛打開（這一次畫才播開門、東西跳出來的動畫；之後重畫就直接是打開的樣子） */
  fresh?: boolean;
  find?: { emoji: string; name: string; id: ItemId; count: number } | null;
  line?: string;
}

export function buildMeal(doc: Document, o: {
  kind: 'table' | 'snack' | 'fridge';
  herName: string;
  foods: FoodRow[];
  satiety: { now: number; max: number };
  snack?: SnackRow;
  fridge?: FridgeState;
  /** 剛吃完的那一句（顯示在上面的對話框） */
  line?: string;
  /** 正在吃（送出去還沒回來）：按鈕先鎖住 */
  eating?: boolean;
  onEat(id: ItemId): void;
  onSnack(): void;
  onGo(where: 'fridge' | 'stove'): void;
  onClose(): void;
}): HTMLElement {
  const root = el(doc, 'div', `px-shop px-meal px-meal-${o.kind}`);
  const head = el(doc, 'div', 'px-arcade-head');
  const full = o.satiety.now >= o.satiety.max;
  head.append(el(doc, 'span', '', `🍙 飽食 ${Math.round(o.satiety.now)} / ${o.satiety.max}`), el(doc, 'span', '', full ? '她現在吃不下了' : '選一樣餵她吃'));
  root.append(head);

  if (o.kind === 'fridge') root.append(fridgeBox(doc, o.fridge ?? { opening: true }));
  if (o.kind === 'snack' && o.snack) {
    const s = o.snack;
    const box = el(doc, 'div', 'px-meal-snack');
    const plate = el(doc, 'div', 'px-meal-plate');
    for (let i = 0; i < s.perDay; i++) plate.append(el(doc, 'span', i < s.left ? 'on' : 'off', s.emoji));
    box.append(
      plate,
      el(doc, 'div', 'px-meal-snack-text', s.left > 0 ? `${s.name}上還有 ${s.left} 份（免費，每天補滿 ${s.perDay} 份）` : `今天的${s.name}被吃光了，明天會再補～`),
    );
    const b = button(doc, `${s.emoji} 吃一份（🍙 +${s.satiety}${s.affection ? `　❤ +${s.affection}` : ''}）`, o.onSnack, { disabled: s.left <= 0 || full || !!o.eating, cls: 'px-meal-snack-btn' });
    box.append(b);
    root.append(box);
  }

  if (o.line) root.append(el(doc, 'div', 'px-arcade-msg px-meal-line', `${o.herName}：「${o.line}」`));

  const title = o.kind === 'fridge' ? '🧊 冰箱裡的食物（揹包）' : '🎒 揹包裡能吃的';
  root.append(el(doc, 'div', 'px-meal-title', title));
  if (!o.foods.length) {
    const empty = el(doc, 'div', 'px-meal-empty');
    empty.append(el(doc, 'div', '', o.kind === 'fridge' ? '冰箱裡空空的……' : '揹包裡沒有能吃的東西。'));
    const row = el(doc, 'div', 'px-arcade-btns');
    if (o.kind !== 'fridge') row.append(button(doc, '🧊 去冰箱找找', () => o.onGo('fridge')));
    row.append(button(doc, '🍳 去爐子做料理', () => o.onGo('stove')));
    empty.append(row, el(doc, 'div', 'px-hint', '也可以去釣魚、收成，或到酒館跟老吳點餐。'));
    root.append(empty);
  } else {
    const grid = el(doc, 'div', 'px-meal-grid');
    for (const f of o.foods) {
      const card = el(doc, 'button', `px-meal-food${f.liked ? ' liked' : ''}`) as HTMLButtonElement;
      card.type = 'button';
      card.dataset.item = f.id;
      card.disabled = full || !!o.eating;
      card.title = `${f.name}：🍙 +${f.satiety}　❤ +${f.liked ? f.affection * 2 : f.affection}${f.liked ? '（她最喜歡！）' : ''}`;
      const icon = slotIcon(doc, f.id, f.emoji, 32);
      const n = el(doc, 'span', 'px-meal-count', `×${f.count}`);
      card.append(icon, el(doc, 'span', 'px-meal-name', f.name), el(doc, 'span', 'px-meal-gain', `🍙+${f.satiety}${f.liked ? ' 💖' : ''}`), n);
      card.addEventListener('click', () => o.onEat(f.id));
      grid.append(card);
    }
    root.append(grid);
  }
  const foot = el(doc, 'div', 'px-arcade-btns');
  foot.append(button(doc, o.kind === 'fridge' ? '🚪 關上冰箱' : '👋 吃飽了', o.onClose));
  root.append(foot);
  return root;
}

/** 冰箱：門打開的動畫＋今天找到的東西 */
function fridgeBox(doc: Document, st: FridgeState): HTMLElement {
  const box = el(doc, 'div', `px-fridge${st.opening ? ' opening' : ' open'}${st.fresh ? ' fresh' : ''}`);
  const inside = el(doc, 'div', 'px-fridge-inside');
  // 三層架子：上層一瓶牛奶、中層找到的東西（有的話）、下層蔬菜盒
  inside.append(el(doc, 'div', 'px-fridge-shelf', '🥛 🧈'));
  const mid = el(doc, 'div', 'px-fridge-shelf mid');
  if (st.find) {
    const it = el(doc, 'span', 'px-fridge-find');
    it.append(slotIcon(doc, st.find.id, st.find.emoji, 34));
    if (st.find.count > 1) it.append(el(doc, 'span', 'px-meal-count', `×${st.find.count}`));
    mid.append(it);
  } else if (st.find === null) mid.textContent = '❄️';
  inside.append(mid, el(doc, 'div', 'px-fridge-shelf low', '🥬 🥚'));
  box.append(inside, el(doc, 'div', 'px-fridge-door', '⚓'), el(doc, 'div', 'px-fridge-light'));
  const msg = el(doc, 'div', 'px-fridge-msg');
  msg.textContent = st.opening
    ? '打開冰箱……'
    : st.find
      ? `找到了 ${st.find.emoji} ${st.find.name}${st.find.count > 1 ? ` ×${st.find.count}` : ''}！放進揹包了。`
      : '今天冰箱裡的寶藏已經找過了，明天再來看看。';
  const wrap = el(doc, 'div', 'px-fridge-wrap');
  wrap.append(box, msg);
  if (st.line) wrap.append(el(doc, 'div', 'px-fridge-line', `「${st.line}」`));
  return wrap;
}
