// V0.14：家具目錄（furniture_shop.json）。純畫面：買、二手賣、拿去擺都交給呼叫的人（送 host 的 act）。
import type { FurnitureShopFile, GameView, ItemId } from '../../shared/gameplay-types.ts';
import { resalePrice } from '../../shared/gameplay.ts';
import { button, el } from './ui-panels-v4.ts';
import { slotIcon } from './ui-panels.ts';

export type CatalogTab = 'all' | 'mine' | string;

export function buildFurnitureCatalog(doc: Document, o: {
  file: FurnitureShopFile;
  game: GameView;
  tab: CatalogTab;
  /** 剛買的那件：卡片上多一顆「馬上擺」 */
  justBought?: ItemId | null;
  onTab(t: CatalogTab): void;
  onBuy(id: ItemId): void;
  onSell(id: ItemId): void;
  onPlace(id: ItemId): void;
}): HTMLElement {
  const F = o.file;
  const g = o.game;
  const root = el(doc, 'div', 'px-shop px-catalog');
  const head = el(doc, 'div', 'px-arcade-head');
  head.append(el(doc, 'span', '', `🪙 ${g.coins}`), el(doc, 'span', '', `二手賣出 = 買價 × ${Math.round(F.resaleRate * 100)}%`));
  root.append(head);

  // 分頁：全部、各分類、我的家具（揹包裡還沒擺的＋已經擺出去的）
  const tabs = el(doc, 'div', 'px-tabs');
  const tabList: [CatalogTab, string][] = [['all', '全部'], ...Object.entries(F.categories), ['mine', '🎒 我的家具']];
  for (const [id, label] of tabList) {
    const t = el(doc, 'button', `px-tab${o.tab === id ? ' on' : ''}`, label);
    t.type = 'button';
    t.dataset.tab = id;
    t.addEventListener('click', () => o.onTab(id));
    tabs.append(t);
  }
  root.append(tabs);

  const inBag = (id: ItemId) => g.inventory[id] ?? 0;
  const placed = (id: ItemId) => g.furniture.placed[id] ?? 0;
  const list = F.items.filter((e) =>
    o.tab === 'all' ? true : o.tab === 'mine' ? inBag(e.id) > 0 || placed(e.id) > 0 : e.category === o.tab);
  const grid = el(doc, 'div', 'px-catalog-grid');
  if (!list.length) grid.append(el(doc, 'div', 'px-hint', o.tab === 'mine' ? '還沒有家具。從其他分頁挑一件吧！' : '這一類目前沒有東西'));
  for (const e of list) {
    const card = el(doc, 'div', `px-catalog-card${o.justBought === e.id ? ' new' : ''}`);
    card.dataset.item = e.id;
    const icon = el(doc, 'div', 'px-catalog-icon');
    icon.append(slotIcon(doc, e.id, e.emoji, 40));
    const info = el(doc, 'div', 'px-catalog-info');
    const size = e.category === 'floor' || e.category === 'wall' ? '整面' : `${e.size?.w ?? 1}×${e.size?.h ?? 1} 格`;
    info.append(
      el(doc, 'div', 'px-catalog-name', e.name),
      el(doc, 'div', 'px-catalog-meta', `${F.categories[e.category] ?? e.category}・${size}${e.rug ? '・可疊家具' : ''}`),
    );
    if (e.description) info.append(el(doc, 'div', 'px-catalog-desc', e.description));
    const own = inBag(e.id);
    const out = placed(e.id);
    if (own || out) info.append(el(doc, 'div', 'px-catalog-own', `揹包 ${own}${out ? `・已擺 ${out}` : ''}`));
    const btns = el(doc, 'div', 'px-catalog-btns');
    const short = g.coins < e.price;
    const buy = button(doc, short ? `金幣不足（🪙 ${e.price}）` : `買 🪙 ${e.price}`, () => o.onBuy(e.id), { disabled: short, cls: 'buy', title: short ? `還差 ${e.price - g.coins} 金幣` : undefined });
    btns.append(buy);
    if (own > 0) {
      btns.append(button(doc, e.category === 'floor' || e.category === 'wall' ? '🛠 換上' : '🛠 擺放', () => o.onPlace(e.id), { cls: 'place' }));
      btns.append(button(doc, `二手賣 🪙 ${resalePrice(e.price, F.resaleRate)}`, () => o.onSell(e.id), { cls: 'sell' }));
    }
    card.append(icon, info, btns);
    grid.append(card);
  }
  root.append(grid);
  root.append(el(doc, 'div', 'px-hint', '買的家具會放進 🎒 揹包的「家具」分頁。點揹包裡的家具（或這裡的「擺放」）進入裝修模式；裝修模式點已經擺的家具會收回揹包。不要的家具可以在這裡二手賣出（要先收回揹包）。'));
  return root;
}
