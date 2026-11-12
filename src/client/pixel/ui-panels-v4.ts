// V0.4 的面板內容：出貨、解鎖、機器、動物、居民、礦洞、禮物碼、設定。
// 純 DOM：只負責長什麼樣子、按了呼叫誰；規則都在 host（act）。
import { COIN, type AnimalState, type BuildingDef, type Cost, type GameplayDefs, type GameView, type ItemId, type MachineDef, type MineReport, type NpcDef, type UnlockDef } from '../../shared/gameplay-types.ts';
import { itemLabel, slotIcon } from './ui-panels.ts';

export const el = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls = '', text?: string) => {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function button(doc: Document, text: string, onClick: () => void, opts: { disabled?: boolean; cls?: string; title?: string } = {}) {
  const b = el(doc, 'button', `px-trade-btn ${opts.cls ?? ''}`.trim(), text);
  b.type = 'button';
  b.disabled = !!opts.disabled;
  if (opts.title) b.title = opts.title;
  b.addEventListener('click', onClick);
  return b;
}

export function formatDuration(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  if (min <= 1) return '不到 1 分鐘';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} 小時${m ? ` ${m} 分` : ''}` : `${m} 分鐘`;
}

/** 「🪙 金幣 ×300（有 120）」：不夠的標紅 */
export function costLine(doc: Document, defs: GameplayDefs, cost: Cost, inv: Record<ItemId, number>): HTMLElement {
  const span = el(doc, 'span', 'px-cost');
  const parts = Object.entries(cost);
  if (!parts.length) span.textContent = '免費';
  parts.forEach(([id, n], i) => {
    const it = itemLabel(defs, id);
    const have = inv[id] ?? 0;
    const s = el(doc, 'span', have >= n ? '' : 'px-short', `${it.emoji} ${it.name} ×${n}（有 ${have}）`);
    if (i) span.append('、');
    span.append(s);
  });
  return span;
}

export const canPay = (inv: Record<ItemId, number>, c: Cost) => Object.entries(c).every(([id, n]) => (inv[id] ?? 0) >= n);

/**
 * V0.6.2：按鈕的狀態直接寫在按鈕上，不用按了才跳「數量不夠」。
 * 錢不夠 →「金幣不足」；其他材料不夠 →「材料不足」；夠了就是原本的字。
 */
export function costState(inv: Record<ItemId, number>, c: Cost, verb: string): { ok: boolean; text: string } {
  const short = Object.entries(c).filter(([id, n]) => (inv[id] ?? 0) < n).map(([id]) => id);
  if (!short.length) return { ok: true, text: verb };
  return { ok: false, text: short.includes(COIN) ? '金幣不足' : '材料不足' };
}
const row = (doc: Document, ...kids: (Node | string)[]) => {
  const r = el(doc, 'div', 'px-trade');
  r.append(...kids);
  return r;
};

// ───────────── 出貨箱 ─────────────
export function buildSell(doc: Document, o: {
  defs: GameplayDefs; inventory: Record<ItemId, number>; greeting?: string; buys?: string[]; onSell(item: ItemId, count: number): void;
}) {
  const root = el(doc, 'div', 'px-shop');
  root.append(el(doc, 'div', 'px-greeting', `${o.greeting ?? '放進來的東西馬上換成金幣。'}現在有 🪙 ${o.inventory[COIN] ?? 0}`));
  const list = el(doc, 'div', 'px-trades');
  const items = Object.entries(o.inventory)
    .map(([id, n]) => ({ id, n, ...itemLabel(o.defs, id) }))
    .filter((x) => x.n > 0 && x.id !== COIN && (x.def?.price ?? 0) > 0 && (!o.buys || o.buys.includes(x.def?.category ?? '')))
    .sort((a, b) => (b.def!.price! * b.n) - (a.def!.price! * a.n));
  for (const it of items) {
    const p = it.def!.price!;
    list.append(row(doc,
      el(doc, 'span', 'px-give', `${it.emoji} ${it.name} ×${it.n}`),
      el(doc, 'span', 'px-get', `每個 🪙 ${p}`),
      button(doc, '賣 1 個', () => o.onSell(it.id, 1)),
      button(doc, `全賣（🪙 ${p * it.n}）`, () => o.onSell(it.id, it.n))));
  }
  root.append(items.length ? list : el(doc, 'div', 'px-empty', o.buys ? '揹包裡沒有這裡收的東西。' : '揹包裡沒有能賣的東西。'));
  return root;
}

// ───────────── 解鎖 ─────────────
export function buildUnlock(doc: Document, o: { id: string; def: UnlockDef; defs: GameplayDefs; inventory: Record<ItemId, number>; unlocked: string[]; onUnlock(): void }) {
  const root = el(doc, 'div', 'px-shop');
  root.append(el(doc, 'div', 'px-greeting', o.def.description ?? '解鎖之後就能使用。'));
  const need = o.def.requires && !o.unlocked.includes(o.def.requires) ? o.defs.file.unlocks?.[o.def.requires] : undefined;
  const cs = costState(o.inventory, o.def.cost, '解鎖');
  root.append(row(doc, el(doc, 'span', 'px-give', '需要：'), costLine(doc, o.defs, o.def.cost, o.inventory),
    button(doc, need ? '要先解鎖前一項' : cs.text, o.onUnlock, { disabled: !cs.ok || !!need })));
  if (need) root.append(el(doc, 'div', 'px-hint', `要先解鎖「${need.emoji ?? ''} ${need.name}」`));
  return root;
}

// ───────────── 加工機器 ─────────────
export function buildMachine(doc: Document, o: {
  def: MachineDef; defs: GameplayDefs; state: (GameView['machines'][string]) | null | undefined; inventory: Record<ItemId, number>; now: number;
  onStart(recipe: string): void; onCollect(): void;
}) {
  const root = el(doc, 'div', 'px-shop');
  const label = (get: Record<ItemId, number>) => Object.entries(get).map(([id, n]) => {
    const it = itemLabel(o.defs, id);
    return `${it.emoji} ${it.name} ×${n}`;
  }).join('、');
  if (o.state) {
    const r = o.def.recipes.find((x) => x.id === o.state!.recipe);
    const what = r ? label(r.get) : '？？';
    root.append(el(doc, 'div', 'px-greeting', o.state.ready ? `做好了：${what}` : `製作中：${what}，還要 ${formatDuration(o.state.readyAt - o.now)}`));
    root.append(button(doc, '拿出來', o.onCollect, { disabled: !o.state.ready }));
    return root;
  }
  root.append(el(doc, 'div', 'px-greeting', '放材料進去，過一段時間來拿成品。'));
  const list = el(doc, 'div', 'px-trades');
  for (const r of o.def.recipes) {
    const cs = costState(o.inventory, r.give, '放進去');
    const ok = cs.ok;
    const rr = row(doc, costLine(doc, o.defs, r.give, o.inventory), el(doc, 'span', 'px-arrow', '→'),
      el(doc, 'span', 'px-get', `${label(r.get)}（${formatDuration(r.minutes * 60_000)}）`), button(doc, cs.text, () => o.onStart(r.id), { disabled: !ok }));
    if (!ok) rr.classList.add('disabled');
    list.append(rr);
  }
  root.append(list);
  return root;
}

// ───────────── 動物 ─────────────
export function buildAnimals(doc: Document, o: {
  id: string; def: BuildingDef; defs: GameplayDefs; view: GameView['buildings'][string]; animals: (AnimalState & { hungry: boolean; pettedToday: boolean })[];
  inventory: Record<ItemId, number>; now: number;
  onBuy(kind: string): void; onFeed(): void; onPet(id: number): void; onCollect(): void; onUpgrade(): void; onSell?: (id: number) => void;
}) {
  const root = el(doc, 'div', 'px-shop');
  const pending = o.animals.filter((a) => a.pending).length;
  const hungry = o.animals.filter((a) => a.hungry).length;
  const feeds = new Set(o.animals.map((a) => o.defs.file.animals?.[a.kind]?.feed).filter((x): x is string => !!x));
  const feedText = [...feeds].map((f) => `${itemLabel(o.defs, f).emoji} ${itemLabel(o.defs, f).name}（有 ${o.inventory[f] ?? 0}）`).join('、') || '乾草';
  root.append(el(doc, 'div', 'px-greeting', `${o.animals.length} / ${o.view.capacity} 隻｜等級 ${o.view.level + 1}｜要吃：${feedText}`));
  type AnimalRow = (typeof o.animals)[number] & { adult?: boolean; growsAt?: number; sellPrice?: number };
  const bar = el(doc, 'div', 'px-row-btns');
  bar.append(
    button(doc, `🌾 餵全部（${hungry} 隻餓了）`, o.onFeed, { disabled: !hungry }),
    button(doc, `🧺 收產品（${pending}）`, o.onCollect, { disabled: !pending }));
  const next = o.def.levels[o.view.level + 1];
  if (next) bar.append(button(doc, canPay(o.inventory, next.cost) ? `⬆ 升級到 ${next.capacity} 隻` : `⬆ 升級（${costState(o.inventory, next.cost, '').text}）`, o.onUpgrade, { disabled: !canPay(o.inventory, next.cost), title: Object.entries(next.cost).map(([k, n]) => `${itemLabel(o.defs, k).name} ×${n}`).join('、') }));
  root.append(bar);
  const list = el(doc, 'div', 'px-trades');
  for (const a of o.animals as AnimalRow[]) {
    const def = o.defs.file.animals?.[a.kind];
    const baby = a.adult === false;
    const mood = a.mood >= 70 ? '😊' : a.mood >= 40 ? '🙂' : '😟';
    const hearts = '❤'.repeat(Math.floor(a.friendship / 200)) || '♡';
    const status = baby ? `🍼 幼崽，還要 ${formatDuration(Math.max(0, (a.growsAt ?? 0) - o.now))} 長大`
      : a.pending ? `有 ${itemLabel(o.defs, a.pending).emoji} 可以收` : a.hungry ? '肚子餓' : `下一次：${formatDuration(Math.max(0, a.readyAt - o.now))}`;
    const r = row(doc, el(doc, 'span', 'px-give', `${baby ? def?.baby?.emoji ?? def?.emoji : def?.emoji ?? '❓'} ${a.name}`), el(doc, 'span', 'px-get', `${mood} ${hearts}｜${status}`),
      button(doc, a.pettedToday ? '今天摸過了' : '🤚 摸摸', () => o.onPet(a.id), { disabled: a.pettedToday }));
    if (o.onSell && a.sellPrice) r.append(button(doc, `賣給商人 🪙${a.sellPrice}`, () => o.onSell!(a.id), { cls: 'px-sell-animal' }));
    list.append(r);
  }
  if (o.animals.length) root.append(list);
  root.append(el(doc, 'div', 'px-hint', '每天摸一次會更親近；吃飽、心情好時有機會產出高級品。'));
  // 買動物
  const shop = el(doc, 'div', 'px-trades');
  for (const [kind, def] of Object.entries(o.defs.file.animals ?? {})) {
    if (def.building !== o.id) continue;
    const full = o.animals.length >= o.view.capacity;
    const cs = costState(o.inventory, def.price, '買');
    const ok = cs.ok && !full;
    const product = itemLabel(o.defs, def.product);
    const who = def.baby ? `${def.baby.emoji} ${def.baby.name}` : `${def.emoji} ${def.name}`;
    const grow = def.baby ? `${def.baby.growHours} 小時長大，之後` : '';
    const r = row(doc, el(doc, 'span', 'px-give', who), el(doc, 'span', 'px-get', `${grow}每 ${def.hours} 小時產 ${product.emoji} ${product.name}`),
      costLine(doc, o.defs, def.price, o.inventory), button(doc, full ? '滿了' : cs.text, () => o.onBuy(kind), { disabled: !ok }));
    if (!ok) r.classList.add('disabled');
    shop.append(r);
  }
  root.append(el(doc, 'div', 'px-subtitle', '買幼崽'), shop);
  return root;
}

// ───────────── 居民 ─────────────
export function buildNpc(doc: Document, o: {
  def: NpcDef; defs: GameplayDefs; state: GameView['npcs'][string]; inventory: Record<ItemId, number>;
  onTalk(): void; onGift(item: ItemId): void; shops?: { label: string; onClick(): void }[];
  /** V0.6.2：只顯示好感和送禮（聊天、商店改在 RPG 對話框的選項裡） */
  giftOnly?: boolean;
}) {
  const root = el(doc, 'div', 'px-shop');
  const hearts = '❤'.repeat(o.state.hearts) + '♡'.repeat(Math.max(0, 10 - o.state.hearts));
  root.append(el(doc, 'div', 'px-greeting', `${hearts}　好感 ${o.state.friendship} / 1000`));
  const bar = el(doc, 'div', 'px-row-btns');
  bar.append(button(doc, o.state.talkedToday ? '💬 聊天（今天聊過了）' : '💬 聊天', o.onTalk));
  for (const sh of o.shops ?? []) bar.append(button(doc, sh.label, sh.onClick));
  if (!o.giftOnly) root.append(bar);
  const known = (ids: ItemId[] | undefined) => (ids ?? []).filter((i) => o.state.hearts >= 2 || o.inventory[i]).map((i) => itemLabel(o.defs, i).emoji).join(' ');
  if (o.state.hearts >= 2) root.append(el(doc, 'div', 'px-hint', `最喜歡：${known(o.def.loves) || '？'}　喜歡：${known(o.def.likes) || '？'}`));
  root.append(el(doc, 'div', 'px-subtitle', o.state.giftedToday ? '🎁 今天送過禮物了，明天再來' : '🎁 送禮（一天一次）'));
  const grid = el(doc, 'div', 'px-grid');
  for (const [id, n] of Object.entries(o.inventory)) {
    if (n <= 0 || id === COIN) continue;
    const it = itemLabel(o.defs, id);
    const b = el(doc, 'button', 'px-slot');
    b.type = 'button';
    b.disabled = o.state.giftedToday;
    b.title = `送 ${it.name}`;
    b.append(slotIcon(doc, id, it.emoji), el(doc, 'span', 'px-slot-count', `×${n}`), el(doc, 'span', 'px-slot-name', it.name));
    b.addEventListener('click', () => o.onGift(id));
    grid.append(b);
  }
  if (!o.state.giftedToday) root.append(grid);
  return root;
}

// ───────────── 礦洞 ─────────────
export function buildMine(doc: Document, o: {
  defs: GameplayDefs; game: GameView; now: number; floor: number; canDive: boolean;
  onFloor(f: number): void; onStart(): void; onCollect(): void; onDive(): void;
}) {
  const mine = o.defs.file.mine!;
  const root = el(doc, 'div', 'px-shop');
  const g = o.game;
  const eq = g.equipment;
  const name = (id: ItemId | null) => (id ? `${itemLabel(o.defs, id).emoji} ${itemLabel(o.defs, id).name}` : '沒有');
  root.append(el(doc, 'div', 'px-greeting',
    `最深紀錄：${g.mine.deepest} 樓｜鎬子：${name(eq.pickaxe.item)}｜武器：${name(eq.weapon.item)}｜防具：${name(eq.armor.item)}`));
  if (g.mine.trip) {
    const t = g.mine.trip;
    root.append(el(doc, 'div', 'px-subtitle', t.ready ? `她從 ${t.floor} 樓回來了！` : `她在 ${t.floor} 樓，還要 ${formatDuration(t.endsAt - o.now)}`));
    root.append(button(doc, '🧺 接她回來', o.onCollect, { disabled: !t.ready }));
    return root;
  }
  const max = Math.min(g.mine.deepest + 1, mine.zones.at(-1)!.to);
  const zone = mine.zones.find((z) => o.floor >= z.from && o.floor <= z.to)!;
  const pick = el(doc, 'div', 'px-row-btns');
  pick.append(button(doc, '－', () => o.onFloor(Math.max(1, o.floor - 1)), { disabled: o.floor <= 1 }),
    el(doc, 'span', 'px-floor', `${o.floor} 樓（${zone.name}）`),
    button(doc, '＋', () => o.onFloor(Math.min(max, o.floor + 1)), { disabled: o.floor >= max }));
  root.append(pick);
  const weak = eq.pickaxe.power < zone.needPickaxe;
  root.append(el(doc, 'div', 'px-hint',
    `要 ${formatDuration(zone.minutes * 60_000)}、體力 ${mine.staminaCost}；會遇到 ${zone.monsters.map((m) => `${m.emoji}${m.name}`).join('、')}` +
    (weak ? `｜⚠ 鎬子不夠力（要 ${zone.needPickaxe} 級）` : '')));
  const bar = el(doc, 'div', 'px-row-btns');
  bar.append(button(doc, '⛏️ 派她去', o.onStart, { disabled: weak || g.stamina < mine.staminaCost }));
  if (o.canDive) bar.append(button(doc, '🗡️ 親自下去（即時戰鬥）', o.onDive, { disabled: weak }));
  root.append(bar);
  root.append(el(doc, 'div', 'px-hint', '她離開的時候地圖上看不到她；時間到再來接她。打不過會受傷提早回來、戰利品減半。'));
  return root;
}

export function buildReport(doc: Document, defs: GameplayDefs, r: MineReport) {
  const root = el(doc, 'div', 'px-shop');
  root.append(el(doc, 'div', 'px-greeting', r.injured ? `😣 在 ${r.floor} 樓受傷了，提早回來（受到 ${r.damage} 點傷害）` : `🎉 平安從 ${r.floor} 樓回來！（受到 ${r.damage} 點傷害）`));
  if (r.kills.length) root.append(el(doc, 'div', 'px-hint', `打倒：${r.kills.map((k) => `${k.emoji}${k.name} ×${k.count}`).join('、')}`));
  const got = Object.entries(r.items).map(([id, n]) => `${itemLabel(defs, id).emoji} ${itemLabel(defs, id).name} ×${n}`).join('、');
  root.append(el(doc, 'div', 'px-subtitle', `帶回來：${got || '什麼都沒有'}`), el(doc, 'div', 'px-hint', `最深紀錄：${r.deepest} 樓`));
  return root;
}

// ───────────── 禮物碼、名片（擴展 E6） ─────────────
export interface CardData { n: string; lv: string; a: number; f: number; t: number; m: boolean }
export const encodeCard = (c: CardData) => `WC-${btoa(unescape(encodeURIComponent(JSON.stringify(c)))).replace(/=+$/, '')}`;
export function decodeCard(code: string): CardData | null {
  const m = /^WC-([A-Za-z0-9+/]+)$/.exec(code.trim());
  if (!m) return null;
  try {
    const c = JSON.parse(decodeURIComponent(escape(atob(m[1]!)))) as CardData;
    return typeof c.n === 'string' && typeof c.lv === 'string' ? c : null;
  } catch {
    return null;
  }
}

export function buildGifts(doc: Document, o: {
  defs: GameplayDefs; inventory: Record<ItemId, number>; lastCode: string | null; card: string; friend: CardData | null;
  onSend(item: ItemId, count: number): void; onRedeem(code: string): void; onCard(code: string): void;
}) {
  const root = el(doc, 'div', 'px-shop');
  root.append(el(doc, 'div', 'px-subtitle', '🎁 寄禮物'));
  const sel = el(doc, 'select', 'px-input');
  for (const [id, n] of Object.entries(o.inventory)) {
    if (n <= 0) continue;
    const it = itemLabel(o.defs, id);
    const opt = el(doc, 'option', '', `${it.emoji} ${it.name}（有 ${n}）`);
    opt.value = id;
    sel.append(opt);
  }
  const num = el(doc, 'input', 'px-input');
  num.type = 'number';
  num.min = '1';
  num.max = '99';
  num.value = '1';
  num.style.width = '4.5em';
  const sendRow = el(doc, 'div', 'px-row-btns');
  sendRow.append(sel, num, button(doc, '產生禮物碼', () => o.onSend(sel.value, Math.max(1, Math.min(99, Number(num.value) || 1))), { disabled: !sel.options.length }));
  root.append(sendRow);
  if (o.lastCode) {
    const out = el(doc, 'input', 'px-input px-code');
    out.readOnly = true;
    out.value = o.lastCode;
    out.addEventListener('focus', () => out.select());
    root.append(el(doc, 'div', 'px-hint', '把這串碼傳給朋友。東西已經從你的揹包扣掉了。'), out);
  }
  root.append(el(doc, 'div', 'px-subtitle', '📥 收禮物'));
  const inp = el(doc, 'input', 'px-input px-code');
  inp.placeholder = '貼上朋友給你的禮物碼（WG-…）或名片碼（WC-…）';
  const recvRow = el(doc, 'div', 'px-row-btns');
  recvRow.append(inp, button(doc, '收下', () => {
    const v = inp.value.trim();
    if (v.startsWith('WC-')) o.onCard(v);
    else o.onRedeem(v);
  }));
  root.append(recvRow);
  root.append(el(doc, 'div', 'px-subtitle', '🪪 我的名片'));
  const card = el(doc, 'input', 'px-input px-code');
  card.readOnly = true;
  card.value = o.card;
  card.addEventListener('focus', () => card.select());
  root.append(card);
  if (o.friend) {
    const f = o.friend;
    root.append(el(doc, 'div', 'px-greeting', `朋友的鯨魚娘「${f.n}」：${f.lv}（好感 ${f.a}）｜圖鑑 ${f.f}/${f.t}${f.m ? '｜已結婚 💍' : ''}`));
  }
  root.append(el(doc, 'div', 'px-hint', '即時互訪要等 DSH 提供使用者之間的通道；現在先用禮物碼交換東西。'));
  return root;
}

// ───────────── 世界地圖 ─────────────
export interface WorldNode { id: string; name: string; icon: string; x: number; y: number; here: boolean; reachable: boolean; hint?: string }

export function buildWorldMap(doc: Document, o: {
  nodes: WorldNode[]; edges: { a: string; b: string; locked: boolean }[]; herName: string; herAway: boolean; onGo(id: string): void;
  /** V0.12：walk = 點了她會走過去；teleport = 一鍵傳送 */
  mode?: 'walk' | 'teleport'; onMode?(m: 'walk' | 'teleport'): void;
}) {
  const root = el(doc, 'div', 'px-shop');
  const tp = o.mode === 'teleport';
  if (o.onMode) {
    const tabs = el(doc, 'div', 'px-tabs px-world-modes');
    for (const [m, label] of [['walk', '🚶 走過去'], ['teleport', '🌀 一鍵傳送']] as const) {
      const t = el(doc, 'button', `px-tab${(o.mode ?? 'walk') === m ? ' on' : ''}`, label);
      t.type = 'button';
      t.dataset.mode = m;
      t.setAttribute('aria-pressed', String((o.mode ?? 'walk') === m));
      t.addEventListener('click', () => o.onMode!(m));
      tabs.append(t);
    }
    root.append(tabs);
  }
  const cols = Math.max(...o.nodes.map((n) => n.x)) + 1;
  const rows = Math.max(...o.nodes.map((n) => n.y)) + 1;
  // V0.6.3：格子排版（每個地點一格，不會疊在一起）；連線畫在格子中心之間
  const box = el(doc, 'div', 'px-world');
  box.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  box.style.gridTemplateRows = `repeat(${rows}, minmax(6.4em, auto))`;
  const pos = (n: WorldNode) => ({ x: ((n.x + 0.5) / cols) * 100, y: ((n.y + 0.5) / rows) * 100 });
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'px-world-lines');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  const byId = new Map(o.nodes.map((n) => [n.id, n]));
  for (const e of o.edges) {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b) continue;
    const pa = pos(a);
    const pb = pos(b);
    const line = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(pa.x));
    line.setAttribute('y1', String(pa.y));
    line.setAttribute('x2', String(pb.x));
    line.setAttribute('y2', String(pb.y));
    line.setAttribute('class', e.locked ? 'locked' : '');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(line);
  }
  box.append(svg);
  for (const n of o.nodes) {
    const p = pos(n);
    const b = el(doc, 'button', `px-world-node${n.here ? ' here' : ''}${n.reachable ? '' : ' locked'}${tp ? ' tp' : ''}`);
    b.dataset.scene = n.id;
    b.type = 'button';
    void p;
    b.style.gridColumn = String(n.x + 1);
    b.style.gridRow = String(n.y + 1);
    b.title = n.here ? '你們在這裡' : !n.reachable ? n.hint ?? '還去不了' : tp ? `點一下：直接傳送到${n.name}` : `點一下：${o.herAway ? '' : `${o.herName}會`}走去${n.name}`;
    b.append(el(doc, 'span', 'px-world-icon', n.reachable ? n.icon : '🔒'), el(doc, 'span', 'px-world-name', n.name));
    if (n.here) b.append(el(doc, 'span', 'px-world-here', '📍 在這裡'));
    else if (!n.reachable && n.hint) b.append(el(doc, 'span', 'px-world-hint', n.hint));
    b.disabled = (n.here && !(tp && n.id === 'mine')) || !n.reachable;
    b.addEventListener('click', () => o.onGo(n.id));
    box.append(b);
  }
  const legend = el(doc, 'div', 'px-world-legend');
  legend.append(el(doc, 'span', 'here', '📍 你們在這裡'), el(doc, 'span', 'go', tp ? '可以傳送（點一下）' : '可以去（點一下）'), el(doc, 'span', 'lock', '🔒 還沒解鎖'));
  root.append(box, legend, el(doc, 'div', 'px-hint', tp
    ? '一鍵傳送：點一個地方，黑幕一下就到了（快捷鍵 T）。還沒解鎖的地方一樣去不了；在礦洞打怪、釣魚時不能傳送。'
    : '點一個地方，她會自己一張一張地圖走過去（點地圖上別的地方可以取消）。遊戲畫面邊緣的白色箭頭就是出口。想直接過去就切到「🌀 一鍵傳送」（快捷鍵 T）。'));
  return root;
}
