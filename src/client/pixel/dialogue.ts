// 經典 RPG 對話框（V0.6.2）：在遊戲畫面中間偏下，半透明黑底白字，左邊頭像加名牌，文字逐字出現。
// 點一下：還在打字就直接顯示全文；已經顯示完就關閉。不點的話，顯示完 holdMs 後自動關。
// 有選項（例如跟居民說話：聊天／送禮／逛商店／離開）時，要選一個才會關，不會自動關。
import { cssUrl } from '../css-url.ts';

export interface DialogueOptions {
  name: string;
  portraitUrl?: string;
  portraitFrames?: number;
  portraitFps?: number;
  charsPerSec: number;
  holdMs: number;
}

export class DialogueBox {
  readonly el: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private typing?: ReturnType<typeof setInterval>;
  private holdTimer?: ReturnType<typeof setTimeout>;
  private chars: string[] = [];
  private shown = 0;
  private onClose?: () => void;
  private readonly portraitEl?: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly emojiEl: HTMLDivElement;
  private readonly choicesEl: HTMLDivElement;
  private menu = false;

  constructor(parent: HTMLElement, private readonly opts: DialogueOptions) {
    const doc = parent.ownerDocument;
    const div = (cls: string) => Object.assign(doc.createElement('div'), { className: cls });
    this.el = div('px-dialog');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-live', 'polite');
    this.textEl = div('px-dialog-text');
    this.choicesEl = div('px-dialog-choices');
    this.choicesEl.hidden = true;
    const main = div('px-dialog-main');
    main.append(this.textEl, this.choicesEl);
    const side = div('px-dialog-side');
    if (opts.portraitUrl) {
      const portrait = div('px-portrait');
      const frames = opts.portraitFrames ?? 1;
      portrait.style.backgroundImage = cssUrl(opts.portraitUrl);
      portrait.style.backgroundSize = `${frames * 100}% 100%`;
      if (frames > 1) {
        portrait.style.animation = `px-frames ${frames / (opts.portraitFps ?? 8)}s steps(${frames}, jump-none) infinite`;
      }
      // 依圖片比例決定頭像框的高度
      const img = new Image();
      img.onload = () => (portrait.style.aspectRatio = `${img.naturalWidth / frames} / ${img.naturalHeight}`);
      img.src = opts.portraitUrl;
      side.append(portrait);
      this.portraitEl = portrait;
    }
    // 別人說話時（居民）：用 emoji 當頭像
    this.emojiEl = div('px-portrait-emoji');
    this.emojiEl.hidden = true;
    side.append(this.emojiEl);
    const name = div('px-name');
    name.textContent = opts.name;
    side.append(name);
    this.nameEl = name;
    this.el.append(side, main); // 頭像在左
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.choicesEl.contains(e.target as Node)) return; // 按選項：交給按鈕
      if (this.shown < this.chars.length) this.finish();
      else if (!this.menu) this.close();
    });
    parent.append(this.el);
  }

  get open(): boolean {
    return this.el.classList.contains('show');
  }

  /** atTop：角色在畫面下半部時把對話框放上面，才不會擋住她 */
  show(text: string, onClose?: () => void, atTop = false, speaker?: { name: string; emoji: string; image?: string }): void {
    this.stopTimers();
    this.menu = false;
    this.choicesEl.hidden = true;
    this.choicesEl.replaceChildren();
    this.el.classList.remove('menu');
    this.nameEl.textContent = speaker?.name ?? this.opts.name;
    // 居民說話：有圖就用圖（像素放大），沒有就用 emoji
    this.emojiEl.replaceChildren();
    if (speaker?.image) {
      const img = this.emojiEl.ownerDocument.createElement('img');
      img.className = 'px-portrait-img';
      img.src = speaker.image;
      img.alt = speaker.name;
      this.emojiEl.append(img);
    } else this.emojiEl.textContent = speaker?.emoji ?? '';
    this.emojiEl.hidden = !speaker;
    if (this.portraitEl) this.portraitEl.hidden = !!speaker;
    this.el.classList.toggle('top', atTop);
    this.el.classList.remove('thinking');
    this.onClose?.();
    this.onClose = onClose;
    this.chars = Array.from(text); // 以字元切，emoji 不會被切壞
    this.shown = 0;
    this.textEl.textContent = '';
    this.el.classList.remove('done');
    this.el.classList.add('show');
    const step = Math.max(10, 1000 / this.opts.charsPerSec);
    this.typing = setInterval(() => {
      this.shown = Math.min(this.chars.length, this.shown + 1);
      this.textEl.textContent = this.chars.slice(0, this.shown).join('');
      if (this.shown >= this.chars.length) this.finish();
    }, step);
  }

  /**
   * V0.8：等 AI 回話時，對話框先打開、顯示會跳動的「思考中…」，不會自動關。
   * 回話到了再呼叫 show() 換成真正的句子（接著逐字打出來）。點一下可以先關掉。
   */
  thinking(speaker?: { name: string; emoji: string; image?: string }, atTop = false, label = '思考中'): void {
    this.show('', undefined, atTop, speaker);
    this.stopTimers();
    this.el.classList.add('thinking', 'done');
    this.textEl.replaceChildren();
    const doc = this.el.ownerDocument;
    const text = doc.createElement('span');
    text.className = 'px-think-label';
    text.textContent = label;
    const dots = doc.createElement('span');
    dots.className = 'px-think-dots';
    dots.append(doc.createElement('i'), doc.createElement('i'), doc.createElement('i'));
    this.textEl.append(text, dots);
  }

  /** 說一句話，下面列出選項；選了選項才會關（「離開」也是一個選項） */
  choose(text: string, options: { label: string; onClick: () => void; disabled?: boolean; title?: string }[], speaker?: { name: string; emoji: string; image?: string }, onClose?: () => void): void {
    this.show(text, onClose, false, speaker);
    this.menu = true;
    this.el.classList.add('menu');
    const doc = this.el.ownerDocument;
    for (const o of options) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'px-choice';
      b.textContent = o.label;
      b.disabled = !!o.disabled;
      if (o.title) b.title = o.title;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        o.onClick();
      });
      this.choicesEl.append(b);
    }
    this.choicesEl.hidden = false;
  }

  private finish(): void {
    this.stopTimers();
    this.shown = this.chars.length;
    this.textEl.textContent = this.chars.join('');
    this.el.classList.add('done');
    if (!this.menu) this.holdTimer = setTimeout(() => this.close(), this.opts.holdMs);
  }

  close(): void {
    this.stopTimers();
    if (!this.open) return;
    this.el.classList.remove('show', 'done', 'menu', 'thinking');
    this.menu = false;
    const cb = this.onClose;
    this.onClose = undefined;
    cb?.();
  }

  private stopTimers(): void {
    clearInterval(this.typing);
    clearTimeout(this.holdTimer);
  }

  dispose(): void {
    this.stopTimers();
    this.onClose = undefined;
    this.el.remove();
  }
}
