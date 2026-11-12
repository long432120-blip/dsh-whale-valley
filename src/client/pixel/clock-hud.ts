// V0.16：時間與天氣的木牌 HUD（常駐在遊戲畫面的角落）。
// 資料綁定：每次 host 送來新的狀態（setView）就 bind 一次；中間每秒用「上次的遊戲時間＋過了多久」更新分鐘。
// 快轉時間、睡覺跳到隔天、天氣突變都會送新的狀態過來，所以木牌會馬上跟著變。
// 晚上（nightFrom 以後）木牌蓋一層藍色（只蓋在木牌的形狀上）；天氣換了，圖示縮放彈跳一下。
import { clockFace, type ClockFace, type ClockHudDef, type ClockInput } from '../../shared/clock-hud.ts';
import { el } from './ui-panels-v4.ts';

export class ClockHud {
  private readonly root: HTMLDivElement;
  private readonly seasonIcon: HTMLSpanElement;
  private readonly seasonText: HTMLSpanElement;
  private readonly phaseIcon: HTMLSpanElement;
  private readonly timeText: HTMLSpanElement;
  private readonly weatherIcon: HTMLSpanElement;
  private readonly weatherText: HTMLSpanElement;
  private input: ClockInput | null = null;
  /** 收到 input 時的本機時間（用來推算現在的遊戲時間） */
  private boundAt = 0;
  private lastWeather: string | null = null;
  private lastSig = '';
  private timer = 0;

  /** after：放在這個元素後面（畫面上的黑幕、對話框在它後面，所以會蓋在木牌上面） */
  constructor(parent: HTMLElement, private readonly def: ClockHudDef, asset: (p: string) => string, after?: Element) {
    const doc = parent.ownerDocument;
    this.root = el(doc, 'div', `px-clock ${def.corner ?? 'top-right'}`);
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'off');
    const board = asset(def.board);
    this.root.style.setProperty('--px-clock-board', `url("${board}")`);
    this.root.style.setProperty('--px-clock-icons', `url("${asset(def.icons.src)}")`);
    this.root.style.setProperty('--px-clock-icon-count', String(def.icons.names.length));
    const bg = el(doc, 'div', 'px-clock-bg');
    const shade = el(doc, 'div', 'px-clock-night');
    this.weatherIcon = el(doc, 'span', 'px-clock-wicon');
    this.weatherText = el(doc, 'span', 'px-clock-wname');
    const wx = el(doc, 'div', 'px-clock-weather');
    wx.append(this.weatherIcon, this.weatherText);
    this.seasonIcon = el(doc, 'span', 'px-clock-sicon');
    this.seasonText = el(doc, 'span', 'px-clock-season');
    this.phaseIcon = el(doc, 'span', 'px-clock-picon');
    this.timeText = el(doc, 'span', 'px-clock-time');
    const l1 = el(doc, 'div', 'px-clock-line');
    l1.append(this.seasonIcon, this.seasonText);
    const l2 = el(doc, 'div', 'px-clock-line');
    l2.append(this.phaseIcon, this.timeText);
    const text = el(doc, 'div', 'px-clock-text');
    text.append(l1, l2);
    this.root.append(bg, shade, wx, text);
    this.root.hidden = true;
    if (after?.parentElement === parent) after.after(this.root);
    else parent.append(this.root);
    // 換天氣的彈跳播完就拿掉，下次才能再播
    this.weatherIcon.addEventListener('animationend', () => this.weatherIcon.classList.remove('bounce'));
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  /** 新的遊戲狀態（host 每次回傳 view 都呼叫）；input = null 時藏起來（例如沒有玩法資料） */
  bind(input: ClockInput | null): void {
    this.input = input;
    this.boundAt = Date.now();
    this.render();
  }

  /** 現在的遊戲時間：上次 host 給的時間＋之後過了多久 */
  now(): number {
    return this.input ? this.input.now + (Date.now() - this.boundAt) : Date.now();
  }

  face(): ClockFace | null {
    return this.input ? clockFace(this.def, { ...this.input, now: this.now() }) : null;
  }

  private render(): void {
    const f = this.face();
    this.root.hidden = !f;
    if (!f) return;
    const sig = `${f.season}|${f.time}|${f.weatherId}|${f.night}|${f.seasonIcon}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    setIcon(this.seasonIcon, f.seasonIcon, f.seasonEmoji);
    this.seasonText.textContent = f.season;
    this.phaseIcon.textContent = f.phaseIcon;
    this.timeText.textContent = f.time;
    setIcon(this.weatherIcon, f.weatherIcon, f.weatherEmoji);
    this.weatherText.textContent = f.weatherName;
    this.root.classList.toggle('night', f.night);
    this.root.dataset.phase = f.phase;
    this.root.dataset.weather = f.weatherId;
    this.root.title = `${f.seasonEmoji} ${f.season}　${f.phaseIcon} ${f.time}　${f.weatherEmoji} ${f.weatherName}`;
    // 天氣切換：圖示縮放彈跳（第一次出現不跳）
    if (this.lastWeather !== null && this.lastWeather !== f.weatherId) {
      this.weatherIcon.classList.remove('bounce');
      void this.weatherIcon.offsetWidth; // 重新開始動畫
      this.weatherIcon.classList.add('bounce');
    }
    this.lastWeather = f.weatherId;
  }

  dispose(): void {
    window.clearInterval(this.timer);
    this.root.remove();
  }
}

/** 有像素圖示就用圖示（背景圖的第幾格），沒有就用 emoji */
function setIcon(span: HTMLSpanElement, index: number, emoji: string) {
  if (index >= 0) {
    span.textContent = '';
    span.classList.add('img');
    span.style.setProperty('--i', String(index));
  } else {
    span.classList.remove('img');
    span.style.removeProperty('--i');
    span.textContent = emoji;
  }
}
