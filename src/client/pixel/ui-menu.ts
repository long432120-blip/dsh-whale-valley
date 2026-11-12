// V0.23：遊戲選單（畫面正中央）：繼續、存檔／讀檔、開新遊戲、設定、結束遊戲。
// 打開方式：畫面左上角的 ☰，或沒有開任何東西時按 Esc。
import type { SlotInfo } from '../../shared/save-slots.ts';
import { t } from '../i18n.ts';
import { button, el } from './ui-panels-v4.ts';

export type MenuView = 'main' | 'slots' | 'new' | { load: number } | { overwrite: number } | { remove: number };

export interface MenuOptions {
  view: MenuView;
  /** 朋友家：不能存檔、讀檔、開新遊戲 */
  visiting: { nick: string } | null;
  /** 這個版本有沒有存檔格（DSH 舊版 host 可能沒有） */
  hasSlots: boolean;
  slots: SlotInfo[] | null;
  busy: boolean;
  /** 上方的小字：例如「🌸 春 第 3 天・🪙 1,200」 */
  status: string;
  message: { text: string; kind: 'ok' | 'err' } | null;
  canSettings: boolean;
  onView(v: MenuView): void;
  onContinue(): void;
  onSave(slot: number): void;
  onLoad(slot: number): void;
  onRemove(slot: number): void;
  onNewGame(): void;
  onSettings(): void;
  onHome(): void;
  onExit(): void;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function slotLine(s: SlotInfo): string {
  if (s.broken) return t('menu.slotBroken');
  if (s.empty || !s.summary) return t('menu.slotEmpty');
  const x = s.summary;
  return [x.season, `🪙 ${x.coins.toLocaleString()}`, `❤ ${x.affection}${x.level ? `（${x.level}）` : ''}`].filter(Boolean).join('・');
}

export function buildGameMenu(doc: Document, o: MenuOptions): HTMLElement {
  const root = el(doc, 'div', 'px-shop px-menu');
  if (o.status) root.append(el(doc, 'div', 'px-menu-status', o.status));
  if (o.message) root.append(el(doc, 'div', `px-menu-msg ${o.message.kind}`, o.message.text));
  const big = (label: string, fn: () => void, cls = '', disabled = false) =>
    button(doc, label, fn, { cls: `px-big-btn px-menu-btn-row ${cls}`, disabled: disabled || o.busy });

  // ── 主選單 ──
  if (o.view === 'main') {
    const list = el(doc, 'div', 'px-menu-list');
    list.append(big(t('menu.continue'), o.onContinue, 'primary'));
    if (o.visiting) {
      list.append(el(doc, 'div', 'px-hint', t('menu.visitingNote', { nick: o.visiting.nick })));
      list.append(big(t('menu.home'), o.onHome));
    } else if (o.hasSlots) {
      list.append(big(t('menu.slots'), () => o.onView('slots')), big(t('menu.newGame'), () => o.onView('new')));
    }
    if (o.canSettings) list.append(big(t('menu.settings'), o.onSettings));
    list.append(big(t('menu.exit'), o.onExit, 'danger'));
    root.append(list, el(doc, 'div', 'px-hint px-menu-tip', t('menu.tip')));
    return root;
  }

  // ── 開新遊戲（確認） ──
  if (o.view === 'new') {
    root.append(el(doc, 'div', 'px-menu-confirm', t('menu.newConfirm')));
    const row = el(doc, 'div', 'px-visit-actions');
    row.append(
      big(t('menu.newYes'), o.onNewGame, 'danger'),
      big(t('menu.back'), () => o.onView('main')),
    );
    root.append(row, el(doc, 'div', 'px-hint', t('menu.newHint')));
    return root;
  }

  // ── 讀檔、覆蓋、刪除（確認） ──
  if (typeof o.view === 'object') {
    const v = o.view;
    const [slot, text, yes, fn, cls] =
      'load' in v ? [v.load, t('menu.loadConfirm', { n: v.load }), t('menu.loadYes'), () => o.onLoad(v.load), 'primary']
      : 'overwrite' in v ? [v.overwrite, t('menu.overwriteConfirm', { n: v.overwrite }), t('menu.overwriteYes'), () => o.onSave(v.overwrite), 'primary']
      : [v.remove, t('menu.removeConfirm', { n: v.remove }), t('menu.removeYes'), () => o.onRemove(v.remove), 'danger'];
    const info = o.slots?.find((s) => s.slot === slot);
    root.append(el(doc, 'div', 'px-menu-confirm', text));
    if (info && !info.empty) root.append(el(doc, 'div', 'px-hint', `${info.savedAt ? `💾 ${fmtTime(info.savedAt)}・` : ''}${slotLine(info)}`));
    const row = el(doc, 'div', 'px-visit-actions');
    row.append(big(yes, fn, cls), big(t('menu.back'), () => o.onView('slots')));
    root.append(row);
    return root;
  }

  // ── 存檔格 ──
  const list = el(doc, 'div', 'px-slot-list');
  if (!o.slots) list.append(el(doc, 'div', 'px-hint', t('menu.loading')));
  for (const s of o.slots ?? []) {
    const card = el(doc, 'div', `px-slot${s.empty ? ' empty' : ''}${s.broken ? ' broken' : ''}`);
    card.dataset.slot = String(s.slot);
    const head = el(doc, 'div', 'px-slot-head');
    head.append(el(doc, 'b', '', t('menu.slotN', { n: s.slot })));
    if (s.savedAt) head.append(el(doc, 'span', 'px-slot-time', `💾 ${fmtTime(s.savedAt)}`));
    card.append(head, el(doc, 'div', 'px-slot-line', slotLine(s)));
    const btns = el(doc, 'div', 'px-slot-btns');
    btns.append(
      button(doc, t('menu.saveHere'), () => (s.empty ? o.onSave(s.slot) : o.onView({ overwrite: s.slot })), { cls: 'px-slot-save', disabled: o.busy }),
      button(doc, t('menu.loadHere'), () => o.onView({ load: s.slot }), { cls: 'px-slot-load', disabled: o.busy || s.empty || !!s.broken }),
      button(doc, '🗑', () => o.onView({ remove: s.slot }), { cls: 'px-slot-del', disabled: o.busy || (s.empty && !s.broken) }),
    );
    card.append(btns);
    list.append(card);
  }
  root.append(list);
  const row = el(doc, 'div', 'px-visit-actions');
  row.append(big(t('menu.back'), () => o.onView('main')));
  root.append(row, el(doc, 'div', 'px-hint', t('menu.slotsHint')));
  return root;
}

/** 結束遊戲後的畫面（單機版：瀏覽器不讓網頁自己關分頁，就顯示「可以關掉了」） */
export function buildGoodbye(doc: Document, onAgain: () => void): HTMLElement {
  const card = el(doc, 'div', 'px-goodbye');
  card.append(
    el(doc, 'div', 'px-goodbye-whale', '🐋'),
    el(doc, 'div', 'px-goodbye-title', t('menu.byeTitle')),
    el(doc, 'div', 'px-goodbye-text', t('menu.byeText')),
    button(doc, t('menu.again'), onAgain, { cls: 'px-big-btn primary' }),
  );
  return card;
}
