// V0.6 的面板內容：寵物（我的寵物、寵物店、野生寵物捕捉）。純 DOM，規則在 host。
import { COIN, type GameplayDefs, type GameView, type ItemId, type PetSpeciesDef, type WildSpawn } from '../../shared/gameplay-types.ts';
import { button, el } from './ui-panels-v4.ts';
import { itemLabel } from './ui-panels.ts';

const SKILL_ICON: Record<string, string> = { auto_pickup: '🦴', crow_guard: '🐦‍⬛', fishing_luck: '🎣', water_plots: '💧', mine_luck: '⛏️' };

function petPic(doc: Document, sp: PetSpeciesDef | undefined, emoji: string, src: (p: string) => string | undefined) {
  const box = el(doc, 'div', 'px-pet-pic');
  const url = sp?.sprite ? src(sp.sprite.src) : undefined;
  const sh = sp?.sprite?.sheet;
  if (url && sh) {
    // 走路圖：只顯示站著的那一格
    const f = el(doc, 'div', 'px-pet-frame');
    f.style.aspectRatio = `${sh.frameWidth} / ${sh.frameHeight}`;
    f.style.backgroundImage = `url("${url}")`;
    f.style.backgroundSize = `${sh.frames * 100}% 100%`;
    f.style.backgroundPosition = `${sh.frames > 1 ? (sh.idle / (sh.frames - 1)) * 100 : 0}% 0`;
    f.setAttribute('role', 'img');
    f.setAttribute('aria-label', sp?.name ?? '');
    box.append(f);
  } else if (url) {
    const img = el(doc, 'img');
    img.src = url;
    img.alt = sp?.name ?? '';
    box.append(img);
  } else box.append(el(doc, 'span', 'px-slot-emoji', emoji));
  return box;
}

function bar(doc: Document, value: number, max: number, cls: string, label: string) {
  const b = el(doc, 'div', `px-pet-bar ${cls}`);
  const fill = el(doc, 'div', 'px-pet-fill');
  fill.style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
  b.append(fill, el(doc, 'span', 'px-pet-bar-text', label));
  return b;
}

/** 怎麼拿到這種寵物：商店價格，或野外出現的條件 */
export function howToGet(sp: PetSpeciesDef, defs: GameplayDefs, sceneName: (id: string) => string): string {
  if (sp.shop) return `寵物店 🪙${sp.shop.price[COIN] ?? 0}`;
  const w = sp.wild!;
  const PH: Record<string, string> = { morning: '早上', afternoon: '下午', evening: '傍晚', night: '晚上' };
  const parts = [w.scenes.map(sceneName).join('、')];
  if (w.weather) parts.push(w.weather.map((x) => defs.file.weather?.types.find((t) => t.id === x)?.name ?? (x === 'rainy' ? '雨天' : x)).join('、'));
  if (w.phases) parts.push(w.phases.map((p) => PH[p] ?? p).join('、'));
  return `野外：${parts.join('・')}（捕捉率 ${Math.round(w.catchRate * 100)}%）`;
}

export interface PetsPanelOptions {
  game: GameView;
  defs: GameplayDefs;
  src: (path: string) => string | undefined;
  sceneName: (id: string) => string;
  onPet(id: number): void;
  onFeed(id: number, item: ItemId): void;
  onCompanion(id: number | null): void;
  onRelease(id: number): void;
}

/** 🐾 我的寵物 */
export function buildPets(doc: Document, o: PetsPanelOptions): HTMLElement {
  const P = o.defs.file.pets!;
  const root = el(doc, 'div', 'px-pets');
  const r = o.game.farmReport;
  if (r) {
    const bits: string[] = [];
    if (r.watered) bits.push(`💧 寵物幫忙澆了 ${r.watered} 塊田`);
    const picked = Object.entries(r.picked).map(([id, n]) => `${itemLabel(o.defs, id).emoji}×${n}`).join(' ');
    if (picked) bits.push(`🦴 撿回來 ${picked}`);
    if (r.scared) bits.push(`🐈 趕走了 ${r.scared} 隻烏鴉`);
    if (r.pecked.length) bits.push(`🐦‍⬛ 烏鴉啄了 ${r.pecked.length} 塊田`);
    if (bits.length) root.append(el(doc, 'div', 'px-greeting', `今天早上：${bits.join('；')}`));
  }
  root.append(el(doc, 'div', 'px-pet-count', `養了 ${o.game.pets.length} / ${P.maxPets} 隻`));
  if (!o.game.pets.length) {
    root.append(el(doc, 'div', 'px-greeting', '還沒有寵物。小鎮的小葵有開寵物角（狗、貓）；也可以帶捕捉網去野外找：'));
  }
  for (const p of o.game.pets) {
    const sp = P.species[p.kind];
    const card = el(doc, 'div', `px-pet-card${p.id === o.game.companion ? ' companion' : ''}`);
    card.dataset.pet = String(p.id);
    const info = el(doc, 'div', 'px-pet-info');
    info.append(el(doc, 'div', 'px-pet-name', `${p.name}${p.name !== p.speciesName ? `（${p.speciesName}）` : ''}${p.id === o.game.companion ? ' ⭐跟班' : ''}`));
    info.append(bar(doc, p.satiety, P.satiety.max, 'food', `🍖 ${p.satiety}`));
    info.append(bar(doc, p.affection, P.affection.max, 'love', `❤ ${p.affection}`));
    if (sp) {
      const state = p.hungry ? '（餓了，技能暫停）' : p.skillActive ? `（作用中 ×${p.skillPower.toFixed(2)}）` : '（有同種技能更強的寵物）';
      info.append(el(doc, 'div', `px-pet-skill${p.skillActive ? ' on' : ''}`, `${SKILL_ICON[sp.skill.kind] ?? '✨'} ${sp.skill.name}${state}：${sp.skill.description}`));
    }
    const btns = el(doc, 'div', 'px-row-btns');
    btns.append(button(doc, p.pettedToday ? '摸過了' : '🤚 摸摸', () => o.onPet(p.id), { disabled: p.pettedToday }));
    // 餵食：揹包裡有、牠吃的東西（最多三種）
    const foods = sp ? Object.keys(o.game.inventory).filter((id) => {
      const cat = o.defs.items.get(id)?.category;
      return sp.diet.some((x) => x.item === id || (x.category && x.category === cat));
    }).slice(0, 3) : [];
    for (const id of foods) {
      const it = itemLabel(o.defs, id);
      btns.append(button(doc, `餵 ${it.emoji}×${o.game.inventory[id]}`, () => o.onFeed(p.id, id), { title: `餵${it.name}`, disabled: p.satiety >= P.satiety.max - 1 }));
    }
    if (!foods.length && sp) {
      const like = sp.diet.map((x) => (x.item ? itemLabel(o.defs, x.item).name : x.category === 'fish' ? '魚' : x.category === 'crop' ? '作物' : x.category ?? '')).join('、');
      btns.append(el(doc, 'span', 'px-pet-hint', `牠吃：${like}`));
    }
    btns.append(p.id === o.game.companion
      ? button(doc, '取消跟班', () => o.onCompanion(null))
      : button(doc, '⭐ 當跟班', () => o.onCompanion(p.id), { title: '跟在鯨魚娘（或主人）後面走' }));
    let armed = false;
    const rel = button(doc, '放生', () => {
      if (!armed) {
        armed = true;
        rel.textContent = '確定放生？';
        return;
      }
      o.onRelease(p.id);
    }, { cls: 'px-danger' });
    btns.append(rel);
    info.append(btns);
    card.append(petPic(doc, sp, p.emoji, o.src), info);
    root.append(card);
  }
  // 圖鑑式的提示：每一種怎麼拿到
  const guide = el(doc, 'div', 'px-pet-guide');
  guide.append(el(doc, 'div', 'px-pet-guide-title', '可以養的寵物'));
  for (const [id, sp] of Object.entries(P.species)) {
    const row = el(doc, 'div', 'px-pet-guide-row');
    row.dataset.kind = id;
    row.append(petPic(doc, sp, sp.emoji, o.src), el(doc, 'div', '', `${sp.name}：${howToGet(sp, o.defs, o.sceneName)}｜${SKILL_ICON[sp.skill.kind] ?? ''} ${sp.skill.name}`));
    guide.append(row);
  }
  root.append(guide);
  return root;
}

/** 🐾 寵物店：上面賣寵物，下面接一般的交換（飼料、捕捉網） */
export function buildPetShop(doc: Document, o: { game: GameView; defs: GameplayDefs; src: (path: string) => string | undefined; onBuy(kind: string): void; trades: HTMLElement }): HTMLElement {
  const P = o.defs.file.pets!;
  const root = el(doc, 'div', 'px-pets');
  const full = o.game.pets.length >= P.maxPets;
  for (const [id, sp] of Object.entries(P.species)) {
    if (!sp.shop) continue;
    const price = sp.shop.price[COIN] ?? 0;
    const card = el(doc, 'div', 'px-pet-card');
    card.dataset.kind = id;
    const info = el(doc, 'div', 'px-pet-info');
    info.append(el(doc, 'div', 'px-pet-name', `${sp.emoji} ${sp.name}　🪙 ${price}`));
    if (sp.description) info.append(el(doc, 'div', 'px-pet-hint', sp.description));
    info.append(el(doc, 'div', 'px-pet-skill on', `${SKILL_ICON[sp.skill.kind] ?? '✨'} ${sp.skill.name}：${sp.skill.description}`));
    const btns = el(doc, 'div', 'px-row-btns');
    btns.append(button(doc, full ? `養滿了（${P.maxPets} 隻）` : o.game.coins < price ? '金幣不足' : `買下（🪙${price}）`, () => o.onBuy(id), { disabled: full || o.game.coins < price }));
    info.append(btns);
    card.append(petPic(doc, sp, sp.emoji, o.src), info);
    root.append(card);
  }
  root.append(o.trades);
  return root;
}

/** 野生寵物：丟哪一種捕捉網 */
export function buildCatch(doc: Document, o: {
  spawn: WildSpawn; defs: GameplayDefs; game: GameView; src: (path: string) => string | undefined; now: number;
  chance(net: ItemId): number; onThrow(net: ItemId): void;
}): HTMLElement {
  const P = o.defs.file.pets!;
  const sp = P.species[o.spawn.kind]!;
  const root = el(doc, 'div', 'px-pets');
  const card = el(doc, 'div', 'px-pet-card wild');
  const info = el(doc, 'div', 'px-pet-info');
  info.append(el(doc, 'div', 'px-pet-name', `野生的${sp.name}！`));
  if (sp.description) info.append(el(doc, 'div', 'px-pet-hint', sp.description));
  info.append(el(doc, 'div', 'px-pet-skill on', `${SKILL_ICON[sp.skill.kind] ?? '✨'} ${sp.skill.name}：${sp.skill.description}`));
  const mins = Math.max(1, Math.ceil((o.spawn.until - o.now) / 60_000));
  info.append(el(doc, 'div', 'px-pet-hint', `大約 ${mins} 分鐘後會離開。抓不到的話，牠可能會跑掉（${Math.round(sp.wild!.flee * 100)}%）。`));
  card.append(petPic(doc, sp, sp.emoji, o.src), info);
  root.append(card);
  const nets = [...o.defs.items.values()].filter((it) => it.net);
  const btns = el(doc, 'div', 'px-row-btns');
  for (const n of nets) {
    const have = o.game.inventory[n.id] ?? 0;
    btns.append(button(doc, `丟 ${n.emoji} ${n.name}（成功率 ${Math.round(o.chance(n.id) * 100)}%，有 ${have}）`, () => o.onThrow(n.id), { disabled: !have }));
  }
  root.append(btns);
  if (o.game.pets.length >= P.maxPets) root.append(el(doc, 'div', 'px-pet-hint', `已經養了 ${P.maxPets} 隻，先放生一隻才能再抓。`));
  if (!nets.some((n) => o.game.inventory[n.id])) root.append(el(doc, 'div', 'px-pet-hint', '沒有捕捉網：小鎮小葵的寵物角有賣。'));
  return root;
}
