// V0.22：多語言（繁體／簡體）
//
// 兩層：
//   1. 語言包 key：新的介面文字寫成 t('social.title')，文字在 locales/zh-TW.json、zh-CN.json 的 ui（兩岸各自寫得自然）
//   2. 自動轉換：其他還沒抽成 key 的文字（舊介面、台詞、物品名、角色包 JSON、AI 的回覆），
//      切到簡體時在畫面上自動轉：先換兩岸用語（zh-CN.json 的 terms，例如 程式碼→代码、網路→网络），再逐字繁轉簡（t2s-chars.json）
//      DOM：MutationObserver 看到新文字就轉；畫布：包住 fillText／strokeText／measureText
//
// 切換語言會重新整理頁面（簡體轉不回繁體，重新載入最乾淨；存檔每個動作都已經存好，不會掉進度）。
import zhTW from '../../locales/zh-TW.json';
import zhCN from '../../locales/zh-CN.json';
import t2s from '../../locales/t2s-chars.json';

export type Locale = 'zh-TW' | 'zh-CN';
export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'zh-CN', label: '简体中文' },
];
export const LOCALE_KEY = 'whale-pet:locale';

interface LocaleFile { ui: Record<string, string>; terms?: Record<string, string> }
export interface LocaleData { 'zh-TW': LocaleFile; 'zh-CN': LocaleFile; pairs: string }

/** 要轉換的屬性（輸入框裡玩家打的字不動） */
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);

export class I18nManager {
  readonly locale: Locale;
  private readonly chars = new Map<string, string>();
  private readonly terms: [RegExp, Record<string, string>] | null;
  private readonly cache = new Map<string, string>();
  private observer: MutationObserver | null = null;

  constructor(private readonly data: LocaleData, locale?: Locale) {
    this.locale = locale ?? 'zh-TW';
    for (let i = 0; i + 1 < data.pairs.length; i += 2) this.chars.set(data.pairs[i]!, data.pairs[i + 1]!);
    // 用語對照：原本的繁體寫法、以及「已經逐字轉過」的寫法都要能對上（打字機效果一個字一個字出現時會先被逐字轉掉）
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(data['zh-CN'].terms ?? {})) {
      map[k] = v;
      map[this.charConvert(k)] = v;
    }
    const keys = Object.keys(map).sort((a, b) => b.length - a.length);
    this.terms = keys.length ? [new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g'), map] : null;
  }

  /** 從 localStorage 讀；沒選過就看瀏覽器語言 */
  static detect(store: Pick<Storage, 'getItem'> | null = safeStorage(), nav: { language?: string } | undefined = globalThis.navigator): Locale {
    const saved = store?.getItem(LOCALE_KEY);
    if (saved === 'zh-TW' || saved === 'zh-CN') return saved;
    return /^zh-(CN|SG|Hans)/i.test(nav?.language ?? '') ? 'zh-CN' : 'zh-TW';
  }

  /** 語言包的文字；{name} 換成參數；沒有就退回繁體、再沒有就回傳 key */
  t(key: string, vars?: Record<string, string | number>): string {
    let s = this.data[this.locale].ui[key] ?? this.data['zh-TW'].ui[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }

  private charConvert(s: string): string {
    let out = '';
    for (const c of s) out += this.chars.get(c) ?? c;
    return out;
  }

  /** 任意文字 → 目前的語言（繁體就原樣） */
  convert(text: string): string {
    if (this.locale === 'zh-TW' || !text || !/[㐀-鿿]/.test(text)) return text;
    const hit = this.cache.get(text);
    if (hit !== undefined) return hit;
    let s = text;
    if (this.terms) s = s.replace(this.terms[0], (m) => this.terms![1][m] ?? m);
    s = this.charConvert(s);
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(text, s);
    return s;
  }

  /** 換語言：存起來（呼叫的人負責重新整理） */
  static save(locale: Locale, store: Pick<Storage, 'setItem'> | null = safeStorage()): void {
    try { store?.setItem(LOCALE_KEY, locale); } catch { /* 存不了就算了 */ }
  }

  /**
   * 簡體模式：把 root 底下現有的字轉好，並持續轉新出現的字。
   * 單機版 root = 整個 body（頁面都是我們的）；DSH 版只轉插件自己的區塊，不動 DSH 的介面。
   */
  install(doc: Document = document, root: HTMLElement = doc.body, opts: { title?: boolean } = { title: true }): void {
    if (this.locale === 'zh-TW' || this.observer) return;
    if (root === doc.body) doc.documentElement.lang = 'zh-CN';
    this.convertTree(root);
    const Obs = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
    this.observer = new Obs((list) => {
      for (const m of list) {
        if (m.type === 'characterData') this.convertText(m.target as Text);
        else if (m.type === 'attributes') this.convertAttr(m.target as Element, m.attributeName!);
        else m.addedNodes.forEach((n) => this.convertTree(n));
      }
    });
    this.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    if (opts.title) {
      doc.title = this.convert(doc.title);
      const titleEl = doc.querySelector('title');
      if (titleEl) new Obs(() => { const c = this.convert(doc.title); if (c !== doc.title) doc.title = c; }).observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  }

  /** 畫布上的字（地圖上的標籤、提示）：包住這一個 context 的 fillText／strokeText／measureText */
  patchContext(ctx: CanvasRenderingContext2D): void {
    if (this.locale === 'zh-TW') return;
    patchCanvas(ctx, (s) => this.convert(s));
  }

  private convertTree(n: Node): void {
    if (n.nodeType === 3) return this.convertText(n as Text);
    if (n.nodeType !== 1) return;
    const el = n as Element;
    if (SKIP.has(el.tagName)) return;
    for (const a of ATTRS) if (el.hasAttribute(a)) this.convertAttr(el, a);
    const walker = el.ownerDocument.createTreeWalker(el, 1 | 4); // 元素、文字
    for (let cur = walker.nextNode(); cur; cur = walker.nextNode()) {
      if (cur.nodeType === 3) {
        if (!SKIP.has(cur.parentElement?.tagName ?? '')) this.convertText(cur as Text);
      } else for (const a of ATTRS) if ((cur as Element).hasAttribute(a)) this.convertAttr(cur as Element, a);
    }
  }
  private convertText(t: Text): void {
    if (SKIP.has(t.parentElement?.tagName ?? '')) return;
    const c = this.convert(t.data);
    if (c !== t.data) t.data = c;
  }
  private convertAttr(el: Element, name: string): void {
    const v = el.getAttribute(name);
    if (!v) return;
    const c = this.convert(v);
    if (c !== v) el.setAttribute(name, c);
  }
}

function patchCanvas(proto: CanvasRenderingContext2D, conv: (s: string) => string): void {
  if ((proto as unknown as { __i18n?: boolean }).__i18n) return;
  (proto as unknown as { __i18n?: boolean }).__i18n = true;
  const fill = proto.fillText;
  const stroke = proto.strokeText;
  const measure = proto.measureText;
  proto.fillText = function (text: string, x: number, y: number, maxWidth?: number) {
    return maxWidth === undefined ? fill.call(this, conv(String(text)), x, y) : fill.call(this, conv(String(text)), x, y, maxWidth);
  };
  proto.strokeText = function (text: string, x: number, y: number, maxWidth?: number) {
    return maxWidth === undefined ? stroke.call(this, conv(String(text)), x, y) : stroke.call(this, conv(String(text)), x, y, maxWidth);
  };
  proto.measureText = function (text: string) {
    return measure.call(this, conv(String(text)));
  };
}

function safeStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** 全遊戲共用的一份（第一次用到時依照 localStorage／瀏覽器語言決定） */
let shared: I18nManager | null = null;
export function i18n(): I18nManager {
  return (shared ??= new I18nManager({ 'zh-TW': zhTW as LocaleFile, 'zh-CN': zhCN as LocaleFile, pairs: (t2s as { pairs: string }).pairs }, I18nManager.detect()));
}
export const t = (key: string, vars?: Record<string, string | number>) => i18n().t(key, vars);
