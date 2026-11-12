// V0.17：鯨魚娘的像素日記（一本小筆記本）。純畫面：翻頁、收好日記交給呼叫的人。
import type { DiaryEntry } from '../../shared/diary.ts';
import { button, el } from './ui-panels-v4.ts';

export function buildDiary(doc: Document, o: {
  herName: string;
  /** 新的在前面 */
  entries: DiaryEntry[];
  index: number;
  /** 這次要一個字一個字寫出來（剛打開最新的一篇、或 AI 剛寫好） */
  typewriter: boolean;
  onPage(index: number): void;
  onClose(): void;
}): HTMLElement {
  const root = el(doc, 'div', 'px-diary');
  const e = o.entries[o.index];
  if (!e) {
    root.append(el(doc, 'div', 'px-diary-empty', `${o.herName}還沒有寫過日記。晚上回房間睡覺，她就會寫下今天的事。`));
    const foot = el(doc, 'div', 'px-arcade-btns');
    foot.append(button(doc, '📔 收好日記', o.onClose));
    root.append(foot);
    return root;
  }
  const book = el(doc, 'div', 'px-diary-book');
  book.dataset.id = e.id;
  book.append(el(doc, 'div', 'px-diary-rings'));
  const page = el(doc, 'div', 'px-diary-page');
  const head = el(doc, 'div', 'px-diary-head');
  head.append(el(doc, 'span', 'px-diary-date', e.date), el(doc, 'span', 'px-diary-weather', `${e.weather.emoji} ${e.weather.name}`));
  page.append(head);
  const text = el(doc, 'div', 'px-diary-text');
  if (e.pending) {
    text.classList.add('pending');
    text.append(el(doc, 'span', 'px-diary-pencil', '✏️'), doc.createTextNode(`${o.herName}正在寫日記……`));
  } else if (o.typewriter) {
    typeOut(text, e.text);
  } else {
    text.textContent = e.text;
  }
  page.append(text);
  if (!e.pending) {
    const sign = el(doc, 'div', 'px-diary-sign', `—— ${o.herName}${e.source === 'ai' ? '　✨' : ''}`);
    if (e.source === 'ai') sign.title = 'AI（DeepSeek）照今天的紀錄寫的';
    page.append(sign);
  }
  if (e.facts.length) {
    const facts = el(doc, 'div', 'px-diary-facts');
    facts.append(el(doc, 'div', 'px-diary-facts-title', '📌 今天的紀錄'));
    const ul = el(doc, 'ul', '');
    for (const f of e.facts.slice(0, 6)) ul.append(el(doc, 'li', '', f));
    facts.append(ul);
    page.append(facts);
  }
  book.append(page);
  root.append(book);
  // 翻頁：新的在前面，所以「前一天」是 index + 1
  const nav = el(doc, 'div', 'px-arcade-btns px-diary-nav');
  nav.append(
    button(doc, '◀ 前一天', () => o.onPage(o.index + 1), { disabled: o.index >= o.entries.length - 1 }),
    el(doc, 'span', 'px-diary-count', `${o.entries.length - o.index} / ${o.entries.length}`),
    button(doc, '後一天 ▶', () => o.onPage(o.index - 1), { disabled: o.index <= 0 }),
  );
  const foot = el(doc, 'div', 'px-arcade-btns');
  foot.append(button(doc, '📔 收好日記', o.onClose));
  root.append(nav, foot);
  return root;
}

/** 一個字一個字寫出來（元素被換掉就停） */
function typeOut(node: HTMLElement, text: string) {
  const chars = [...text];
  node.classList.add('typing');
  let i = 0;
  const view = node.ownerDocument.defaultView;
  const step = () => {
    if (!node.isConnected && i > 0) return;
    i += 1;
    node.textContent = chars.slice(0, i).join('');
    if (i < chars.length) view?.setTimeout(step, 55);
    else node.classList.remove('typing');
  };
  view?.setTimeout(step, 250);
}
