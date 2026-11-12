// V0.22：社交面板（純畫面，動作交給呼叫的人）
//   ⚙️ 設定：語言、暱稱、串門的入口（兩顆按鈕，打開畫面中央的串門視窗）
//   🏡 串門視窗（置中 Modal）：生成我的邀請碼／輸入朋友的邀請碼
//   💬 聊天室：本地模擬（清楚標示）、敏感詞過濾；?dev 時可以填伺服器網址
//   🏪 交易所：今日市集／我的攤位／買朋友的貨／收款
//   📮 信箱：朋友串門留的信、輸入回信碼
//   ✉️ 留信（在朋友家）：寫信、產生回信碼
//   🐾 寵物面板下面：送養（領養碼）、輸入領養碼
// 所有文字用 t()（locales/zh-TW.json、zh-CN.json）。
import type { GameplayDefs, GameView, ItemId } from '../../shared/gameplay-types.ts';
import { stallPriceRange, type Letter, type MarketOffer, type StallListing } from '../../shared/trade.ts';
import type { ChatMessage, ChatMode } from '../chat.ts';
import { LOCALES, t, type Locale } from '../i18n.ts';
import { button, el } from './ui-panels-v4.ts';
import { itemLabel } from './ui-panels.ts';

/** 唯讀的碼輸出框＋複製按鈕 */
export function codeBox(doc: Document, code: string, hint?: string): HTMLElement {
  const wrap = el(doc, 'div', 'px-code-box');
  if (hint) wrap.append(el(doc, 'div', 'px-hint', hint));
  const out = el(doc, 'textarea', 'px-input px-code px-code-out') as HTMLTextAreaElement;
  out.readOnly = true;
  out.rows = code.length > 300 ? 4 : 2;
  out.value = code;
  out.addEventListener('focus', () => out.select());
  const copy = button(doc, t('common.copy'), () => {
    out.select();
    const done = () => { copy.textContent = t('common.copied'); setTimeout(() => (copy.textContent = t('common.copy')), 1500); };
    const nav = doc.defaultView?.navigator;
    if (nav?.clipboard?.writeText) nav.clipboard.writeText(code).then(done, () => { try { doc.execCommand('copy'); done(); } catch { /* 手動複製 */ } });
    else { try { doc.execCommand('copy'); done(); } catch { /* 手動複製 */ } }
  }, { cls: 'px-copy-btn' });
  const row = el(doc, 'div', 'px-row-btns');
  row.append(out, copy);
  wrap.append(row);
  return wrap;
}

/** 貼上碼的輸入框＋按鈕 */
function codeInput(doc: Document, placeholder: string, label: string, onGo: (code: string) => void): HTMLElement {
  const row = el(doc, 'div', 'px-row-btns');
  const inp = el(doc, 'textarea', 'px-input px-code px-code-in') as HTMLTextAreaElement;
  inp.rows = 2;
  inp.placeholder = placeholder;
  inp.spellcheck = false;
  inp.addEventListener('keydown', (e) => e.stopPropagation()); // 不要觸發遊戲快捷鍵
  row.append(inp, button(doc, label, () => { const v = inp.value.trim(); if (v) onGo(v); }));
  return row;
}

function textInput(doc: Document, value: string, max: number, placeholder = ''): HTMLInputElement {
  const inp = el(doc, 'input', 'px-input') as HTMLInputElement;
  inp.value = value;
  inp.maxLength = max;
  inp.placeholder = placeholder;
  inp.addEventListener('keydown', (e) => e.stopPropagation());
  return inp;
}

const fmtTime = (at: number) => {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// ───────────── ⚙️ 設定 ─────────────
export function buildSettings(doc: Document, o: {
  locale: Locale; nick: string; nickMax: number;
  onLocale(l: Locale): void; onNick(nick: string): void; onOpenVisit(tab: VisitTab): void;
}): HTMLElement {
  const root = el(doc, 'div', 'px-shop px-settings');
  // 串門放最上面（側邊欄很矮，放下面常常看不到）
  root.append(el(doc, 'div', 'px-subtitle', t('visit.title')));
  root.append(el(doc, 'div', 'px-hint', t('visit.intro')));
  const btns = el(doc, 'div', 'px-visit-entry');
  btns.append(
    button(doc, t('visit.openMake'), () => o.onOpenVisit('make'), { cls: 'px-big-btn px-visit-open-make' }),
    button(doc, t('visit.openGo'), () => o.onOpenVisit('go'), { cls: 'px-big-btn px-visit-open-go' }),
  );
  root.append(btns);
  root.append(el(doc, 'div', 'px-subtitle', t('settings.language')));
  const langs = el(doc, 'div', 'px-tabs px-lang');
  for (const l of LOCALES) {
    const b = el(doc, 'button', `px-tab${l.id === o.locale ? ' on' : ''}`, l.label);
    b.type = 'button';
    b.dataset.locale = l.id;
    b.setAttribute('aria-pressed', String(l.id === o.locale));
    b.addEventListener('click', () => { if (l.id !== o.locale) o.onLocale(l.id); });
    langs.append(b);
  }
  root.append(langs, el(doc, 'div', 'px-hint', t('settings.languageHint')));

  root.append(el(doc, 'div', 'px-subtitle', t('settings.nick')));
  const nick = textInput(doc, o.nick, o.nickMax);
  nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') o.onNick(nick.value); });
  const nrow = el(doc, 'div', 'px-row-btns');
  nrow.append(nick, button(doc, t('common.save'), () => o.onNick(nick.value)));
  root.append(nrow, el(doc, 'div', 'px-hint', t('settings.nickHint')));

  return root;
}

// ───────────── 🏡 串門視窗（畫面正中央） ─────────────
export type VisitTab = 'make' | 'go';

/** 視窗裡的小提示（「✅ 已複製到剪貼簿！」）：疊在視窗上方，1.8 秒後消失 */
export function modalToast(root: HTMLElement, text: string, kind: 'ok' | 'err' = 'ok') {
  const doc = root.ownerDocument;
  root.querySelector('.px-modal-toast')?.remove();
  const tip = el(doc, 'div', `px-modal-toast ${kind}`, text);
  tip.setAttribute('role', 'status');
  root.append(tip);
  setTimeout(() => tip.classList.add('hide'), 1600);
  setTimeout(() => tip.remove(), 2000);
}

/** 寫入剪貼簿：先用 navigator.clipboard，不行再用舊的 execCommand（雙擊打開的 html 檔常常沒有 clipboard 權限） */
export async function copyToClipboard(doc: Document, text: string, area?: HTMLTextAreaElement): Promise<boolean> {
  try {
    const nav = doc.defaultView?.navigator;
    if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(text); return true; }
  } catch { /* 改用下面的方法 */ }
  try {
    area?.focus();
    area?.select();
    return doc.execCommand('copy');
  } catch {
    return false;
  }
}

export function buildVisitModal(doc: Document, o: {
  tab: VisitTab;
  /** 已經產生好的邀請碼（null = 還沒有） */
  invite: string | null;
  busy: boolean;
  /** 「輸入朋友的邀請碼」打到一半的字（畫面重畫時保留） */
  draft: string;
  /** 前往朋友家失敗的原因（顯示在視窗裡） */
  error: string | null;
  days: number;
  onTab(tab: VisitTab): void;
  onMake(): void;
  onDraft(text: string): void;
  onGo(code: string): void;
  onClose(): void;
}): HTMLElement {
  const root = el(doc, 'div', 'px-shop px-visit-modal');
  const tabs = el(doc, 'div', 'px-tabs px-visit-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [id, label] of [['make', t('visit.tabMake')], ['go', t('visit.tabGo')]] as const) {
    const b = el(doc, 'button', `px-tab${o.tab === id ? ' on' : ''}`, label);
    b.type = 'button';
    b.dataset.tab = id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(o.tab === id));
    b.addEventListener('click', () => { if (o.tab !== id) o.onTab(id); });
    tabs.append(b);
  }
  root.append(tabs);

  const area = el(doc, 'textarea', 'px-input px-code px-visit-code') as HTMLTextAreaElement;
  area.spellcheck = false;
  area.setAttribute('autocomplete', 'off');
  area.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); }); // 打字不要觸發遊戲快捷鍵；Esc 照樣關視窗
  const actions = el(doc, 'div', 'px-visit-actions');
  const close = button(doc, t('visit.close'), o.onClose, { cls: 'px-big-btn px-visit-close' });

  if (o.tab === 'make') {
    root.append(el(doc, 'div', 'px-hint', t('visit.intro')));
    area.readOnly = true;
    area.value = o.invite ?? '';
    area.placeholder = o.busy ? t('visit.making') : t('visit.notYet');
    area.addEventListener('focus', () => area.select());
    root.append(area);
    if (o.invite) root.append(el(doc, 'div', 'px-hint px-visit-meta', t('visit.meta', { n: o.invite.length, days: o.days })));
    const copy = button(doc, t('visit.copy'), () => {
      if (!o.invite) return;
      void copyToClipboard(doc, o.invite, area).then((ok) => modalToast(root, ok ? t('visit.copied') : t('visit.copyFail'), ok ? 'ok' : 'err'));
    }, { cls: 'px-big-btn px-visit-copy', disabled: !o.invite });
    actions.append(copy, close);
    root.append(actions);
    const again = el(doc, 'div', 'px-visit-again');
    again.append(el(doc, 'span', 'px-hint', t('visit.inviteHint')), button(doc, o.busy ? t('visit.making') : t('visit.remake'), o.onMake, { disabled: o.busy, cls: 'px-visit-remake' }));
    root.append(again);
  } else {
    root.append(el(doc, 'div', 'px-hint', t('visit.goIntro')));
    area.value = o.draft;
    area.placeholder = t('visit.paste');
    area.addEventListener('input', () => o.onDraft(area.value));
    root.append(area);
    if (o.error) root.append(el(doc, 'div', 'px-visit-error', `⚠️ ${o.error}`));
    const go = button(doc, o.busy ? t('visit.going') : t('visit.goBtn'), () => {
      const v = area.value.trim();
      if (!v) { modalToast(root, t('visit.empty'), 'err'); area.focus(); return; }
      o.onGo(v);
    }, { cls: 'px-big-btn px-visit-go', disabled: o.busy });
    actions.append(go, close);
    root.append(actions);
  }
  return root;
}

// ───────────── 💬 聊天室 ─────────────
export function buildChat(doc: Document, o: {
  messages: readonly ChatMessage[]; mode: ChatMode; banner: string; nick: string; maxLength: number; dev: boolean;
  /** 回傳 false = 沒送出（字留在輸入框） */
  onSend(text: string): boolean | void; onConnect?(url: string): void;
}): HTMLElement {
  const root = el(doc, 'div', 'px-shop px-chat');
  const status = o.mode === 'server' ? t('chat.online') : o.mode === 'connecting' ? t('chat.connecting') : o.banner;
  root.append(el(doc, 'div', `px-chat-banner ${o.mode}`, status));
  const list = el(doc, 'div', 'px-chat-list');
  list.setAttribute('role', 'log');
  list.setAttribute('aria-live', 'polite');
  if (!o.messages.length) list.append(el(doc, 'div', 'px-hint', t('chat.empty')));
  for (const m of o.messages) {
    const row = el(doc, 'div', `px-chat-msg from-${m.from}`);
    const who = el(doc, 'span', 'px-chat-who', `${m.emoji ? `${m.emoji} ` : ''}${m.nick}`);
    if (m.tag) who.append(el(doc, 'span', 'px-chat-tag', m.tag));
    row.append(who, el(doc, 'span', 'px-chat-text', m.text), el(doc, 'span', 'px-chat-time', fmtTime(m.at)));
    list.append(row);
  }
  root.append(list);
  const inp = textInput(doc, '', o.maxLength, t('chat.placeholder', { nick: o.nick }));
  const send = () => { const v = inp.value; if (v.trim() && o.onSend(v) !== false) { inp.value = ''; inp.focus(); } };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) send(); });
  const row = el(doc, 'div', 'px-row-btns px-chat-input');
  row.append(inp, button(doc, t('chat.send'), send));
  root.append(row, el(doc, 'div', 'px-hint', t('chat.rules', { max: o.maxLength })));
  if (o.dev && o.onConnect) {
    // 預留的伺服器接口：只有開發者模式（?dev）看得到
    const url = textInput(doc, '', 200, 'wss://example.com/chat');
    const r2 = el(doc, 'div', 'px-row-btns');
    r2.append(url, button(doc, t('chat.connect'), () => o.onConnect!(url.value)));
    root.append(el(doc, 'div', 'px-subtitle', t('chat.serverTitle')), r2);
  }
  // 捲到最新
  setTimeout(() => { list.scrollTop = list.scrollHeight; }, 0);
  return root;
}

// ───────────── 🏪 交易所 ─────────────
export type MarketTab = 'market' | 'stall' | 'buy' | 'collect';

export function buildMarket(doc: Document, o: {
  tab: MarketTab; game: GameView; defs: GameplayDefs; maxListings: number; maxQty: number;
  lastStallCode: string | null; lastReceipt: string | null;
  onTab(tab: MarketTab): void;
  onBuyOffer(item: ItemId, qty: number): void;
  onList(item: ItemId, qty: number, price: number): void;
  onCancel(id: string): void;
  onBuyCode(code: string): void;
  onCollect(code: string): void;
}): HTMLElement {
  const root = el(doc, 'div', 'px-shop px-market');
  const tabs = el(doc, 'div', 'px-tabs');
  for (const [id, key] of [['market', 'market.tabMarket'], ['stall', 'market.tabStall'], ['buy', 'market.tabBuy'], ['collect', 'market.tabCollect']] as const) {
    const b = el(doc, 'button', `px-tab${o.tab === id ? ' on' : ''}`, t(key));
    b.type = 'button';
    b.dataset.tab = id;
    b.setAttribute('aria-pressed', String(o.tab === id));
    b.addEventListener('click', () => o.onTab(id));
    tabs.append(b);
  }
  root.append(tabs, el(doc, 'div', 'px-market-coins', t('market.coins', { n: o.game.coins })));
  const social = o.game.social!;

  if (o.tab === 'market') {
    root.append(el(doc, 'div', 'px-hint', t('market.intro')));
    const list = el(doc, 'div', 'px-market-list');
    for (const off of social.market as MarketOffer[]) {
      const it = itemLabel(o.defs, off.item);
      const row = el(doc, 'div', 'px-market-row');
      row.dataset.item = off.item;
      row.append(el(doc, 'span', 'px-market-name', `${it.emoji} ${it.name}`), el(doc, 'span', 'px-market-price', t('market.each', { n: off.price })),
        el(doc, 'span', 'px-market-stock', t('market.left', { n: off.left })));
      row.append(button(doc, t('market.buy'), () => o.onBuyOffer(off.item, 1), { disabled: off.left <= 0 || o.game.coins < off.price }));
      list.append(row);
    }
    root.append(list);
  } else if (o.tab === 'stall') {
    const open = social.stall.filter((l) => l.status === 'open').length;
    root.append(el(doc, 'div', 'px-hint', t('stall.intro', { max: o.maxListings })));
    // 新掛單
    const sellable = Object.entries(o.game.inventory).filter(([id, n]) => n > 0 && stallPriceRange(o.defs, id));
    const form = el(doc, 'div', 'px-row-btns px-stall-form');
    const sel = el(doc, 'select', 'px-input') as HTMLSelectElement;
    for (const [id, n] of sellable) {
      const it = itemLabel(o.defs, id);
      const opt = el(doc, 'option', '', `${it.emoji} ${it.name}（${n}）`) as HTMLOptionElement;
      opt.value = id;
      sel.append(opt);
    }
    const qty = el(doc, 'input', 'px-input') as HTMLInputElement;
    qty.type = 'number'; qty.min = '1'; qty.value = '1'; qty.style.width = '4em';
    qty.setAttribute('aria-label', t('stall.qty'));
    const price = el(doc, 'input', 'px-input') as HTMLInputElement;
    price.type = 'number'; price.min = '1'; price.style.width = '6em';
    price.setAttribute('aria-label', t('stall.price'));
    const range = el(doc, 'div', 'px-hint px-stall-range');
    const sync = () => {
      const r = stallPriceRange(o.defs, sel.value);
      const have = o.game.inventory[sel.value] ?? 0;
      qty.max = String(Math.min(have, o.maxQty));
      if (r) {
        price.min = String(r[0]); price.max = String(r[1]);
        if (!price.value || Number(price.value) < r[0] || Number(price.value) > r[1]) price.value = String(Math.round((r[0] + r[1]) / 3) || r[0]);
        range.textContent = t('stall.range', { lo: r[0], hi: r[1] });
      }
    };
    sel.addEventListener('change', sync);
    for (const i of [qty, price]) i.addEventListener('keydown', (e) => e.stopPropagation());
    sync();
    form.append(sel, el(doc, 'span', '', '×'), qty, el(doc, 'span', '', '🪙'), price,
      button(doc, t('stall.list'), () => o.onList(sel.value, Math.floor(Number(qty.value) || 1), Math.floor(Number(price.value) || 0)),
        { disabled: !sellable.length || open >= o.maxListings }));
    root.append(form, range);
    if (!sellable.length) root.append(el(doc, 'div', 'px-hint', t('stall.nothing')));
    if (o.lastStallCode) root.append(codeBox(doc, o.lastStallCode, t('stall.codeHint')));
    // 攤位上的東西
    root.append(el(doc, 'div', 'px-subtitle', t('stall.mine', { n: open, max: o.maxListings })));
    const listings = [...social.stall].reverse() as StallListing[];
    if (!listings.length) root.append(el(doc, 'div', 'px-hint', t('stall.empty')));
    for (const l of listings) {
      const it = itemLabel(o.defs, l.item);
      const row = el(doc, 'div', `px-stall-row ${l.status}`);
      row.dataset.id = l.id;
      const status = l.status === 'open' ? t('stall.open') : l.status === 'sold' ? t('stall.sold', { who: l.buyer ?? '' }) : t('stall.cancelled');
      row.append(el(doc, 'div', 'px-stall-line', `${it.emoji} ${it.name} ×${l.qty}　${t('market.each', { n: l.price })}　${t('stall.total', { n: l.qty * l.price })}　${status}`));
      if (l.status === 'open') {
        const btns = el(doc, 'div', 'px-row-btns');
        if (l.code) btns.append(codeBox(doc, l.code));
        btns.append(button(doc, t('stall.cancel'), () => o.onCancel(l.id)));
        row.append(btns);
      }
      root.append(row);
    }
  } else if (o.tab === 'buy') {
    root.append(el(doc, 'div', 'px-hint', t('buy.intro')));
    root.append(codeInput(doc, t('buy.paste'), t('buy.go'), o.onBuyCode));
    if (o.lastReceipt) root.append(codeBox(doc, o.lastReceipt, t('buy.receiptHint')));
  } else {
    root.append(el(doc, 'div', 'px-hint', t('collect.intro')));
    root.append(codeInput(doc, t('collect.paste'), t('collect.go'), o.onCollect));
  }
  root.append(el(doc, 'div', 'px-hint px-fair', t('market.fair')));
  return root;
}

// ───────────── 📮 信箱 ─────────────
export function buildMailbox(doc: Document, o: { letters: Letter[]; onReply(code: string): void }): HTMLElement {
  const root = el(doc, 'div', 'px-shop px-mailbox');
  root.append(el(doc, 'div', 'px-hint', t('mail.intro')));
  root.append(codeInput(doc, t('mail.paste'), t('mail.go'), o.onReply));
  root.append(el(doc, 'div', 'px-subtitle', t('mail.letters', { n: o.letters.length })));
  if (!o.letters.length) root.append(el(doc, 'div', 'px-hint', t('mail.empty')));
  for (const l of o.letters) {
    const card = el(doc, 'div', `px-letter${l.read ? '' : ' unread'}`);
    card.append(el(doc, 'div', 'px-letter-head', `✉️ ${l.nick}　${fmtTime(l.at)}${l.watered ? `　${t('mail.watered', { n: l.watered })}` : ''}`));
    if (l.text) card.append(el(doc, 'div', 'px-letter-text', l.text));
    root.append(card);
  }
  return root;
}

// ───────────── ✉️ 在朋友家留信 ─────────────
export function buildLetterComposer(doc: Document, o: {
  host: string; watered: number; max: number; code: string | null; onMake(text: string): void; onHome(): void;
}): HTMLElement {
  const root = el(doc, 'div', 'px-shop px-letter-compose');
  root.append(el(doc, 'div', 'px-hint', t('letter.intro', { host: o.host })));
  const ta = el(doc, 'textarea', 'px-input px-letter-input') as HTMLTextAreaElement;
  ta.maxLength = o.max;
  ta.rows = 3;
  ta.placeholder = t('letter.placeholder', { max: o.max });
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  root.append(ta, el(doc, 'div', 'px-hint', t('letter.watered', { n: o.watered })));
  const row = el(doc, 'div', 'px-row-btns');
  row.append(button(doc, t('letter.make'), () => o.onMake(ta.value)), button(doc, t('visit.home'), o.onHome));
  root.append(row);
  if (o.code) root.append(codeBox(doc, o.code, t('letter.codeHint', { host: o.host })));
  return root;
}

// ───────────── 🐾 寵物：送養、領養 ─────────────
export function buildAdoption(doc: Document, o: {
  pets: { id: number; name: string; emoji: string }[]; readyAt: number; now: number; lastCode: string | null; lastName: string;
  onGive(id: number): void; onAdopt(code: string): void;
}): HTMLElement {
  const root = el(doc, 'div', 'px-adopt');
  root.append(el(doc, 'div', 'px-subtitle', t('adopt.title')));
  const waiting = o.readyAt > o.now;
  root.append(el(doc, 'div', 'px-hint', waiting ? t('adopt.cooldown', { h: Math.ceil((o.readyAt - o.now) / 3_600_000) }) : t('adopt.intro')));
  const row = el(doc, 'div', 'px-row-btns');
  for (const p of o.pets) {
    row.append(button(doc, t('adopt.give', { name: `${p.emoji} ${p.name}` }), () => {
      const confirm = doc.defaultView?.confirm;
      if (!confirm || confirm(t('adopt.confirm', { name: p.name }))) o.onGive(p.id);
    }, { disabled: waiting, cls: 'px-adopt-give' }));
  }
  if (o.pets.length) root.append(row);
  if (o.lastCode) root.append(codeBox(doc, o.lastCode, t('adopt.codeHint', { name: o.lastName })));
  root.append(el(doc, 'div', 'px-subtitle', t('adopt.inTitle')));
  root.append(codeInput(doc, t('adopt.paste'), t('adopt.go'), o.onAdopt));
  return root;
}
