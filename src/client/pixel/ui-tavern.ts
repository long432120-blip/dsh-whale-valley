// V0.13：酒館的小遊戲畫面（街機猜硬幣、牌桌比大小）。
// 這裡只管「畫面現在在哪個狀態、按了要做什麼」；付錢、擲硬幣、抽牌、加好感都在 host（gameplay.ts 的 coin_flip、cards）。
import type { CoinSide } from '../../shared/gameplay-types.ts';
import { button, el } from './ui-panels-v4.ts';

// ───────────── 猜硬幣 ─────────────
/**
 * 猜硬幣的狀態機：
 *   idle ──投幣──▶ choose ──選正／反──▶ flipping ──host 回結果──▶ result ──再玩──▶ choose
 *     │                                     │                        └──不玩了──▶（關掉）
 *     └──金幣不夠──▶ broke                  └──金幣不夠（host 拒絕）──▶ broke
 * 投幣只是進到「選邊」畫面；真的扣錢是在 flipping 時 host 一次做完（付錢＋擲硬幣＋給獎），不會扣了錢沒結果。
 */
export type FlipState =
  | { s: 'idle' }
  | { s: 'choose' }
  | { s: 'flipping'; guess: CoinSide }
  | { s: 'result'; guess: CoinSide; result: CoinSide; win: boolean; coins: number; gain: number; line: string }
  | { s: 'broke'; line: string };

export const COIN_FACE: Record<CoinSide, { name: string; icon: string }> = {
  heads: { name: '正面', icon: '🐋' },
  tails: { name: '反面', icon: '🌊' },
};

export function buildCoinFlip(doc: Document, o: {
  state: FlipState; coins: number; cost: number; reward: number; affectionLeft: number; herName: string;
  onInsert(): void; onGuess(side: CoinSide): void; onAgain(): void; onQuit(): void;
}): HTMLElement {
  const root = el(doc, 'div', 'px-shop px-arcade');
  root.dataset.state = o.state.s;
  const head = el(doc, 'div', 'px-arcade-head');
  head.append(
    el(doc, 'span', '', `🪙 ${o.coins}`),
    el(doc, 'span', '', `一次 ${o.cost} 金幣，猜中拿 ${o.reward}`),
    el(doc, 'span', '', o.affectionLeft > 0 ? `今天還能 ❤ +${o.affectionLeft}` : '今天的好感拿滿了'),
  );
  root.append(head);

  // 硬幣：flipping 時轉；result 時停在結果那一面
  const st = o.state;
  const face = st.s === 'result' ? st.result : st.s === 'flipping' ? st.guess : 'heads';
  const coin = el(doc, 'div', `px-coin${st.s === 'flipping' ? ' spin' : ''}${st.s === 'result' ? (st.win ? ' win' : ' lose') : ''}`, COIN_FACE[face].icon);
  coin.setAttribute('aria-hidden', 'true');
  const stageBox = el(doc, 'div', 'px-arcade-stage');
  stageBox.append(coin);
  root.append(stageBox);

  const msg = el(doc, 'div', 'px-arcade-msg');
  const row = el(doc, 'div', 'px-arcade-btns');
  if (st.s === 'idle') {
    msg.textContent = `${o.herName}盯著街機看：「主人，玩一次好不好？」`;
    row.append(button(doc, `🪙 投 ${o.cost} 金幣`, o.onInsert, { disabled: o.coins < o.cost, title: o.coins < o.cost ? '金幣不夠' : undefined }));
    if (o.coins < o.cost) msg.textContent = `金幣不夠（要 ${o.cost}）。先去賺一點再來玩吧！`;
  } else if (st.s === 'choose') {
    msg.textContent = '硬幣會落在哪一面呢？';
    for (const side of ['heads', 'tails'] as const) {
      const b = button(doc, `${COIN_FACE[side].icon} ${COIN_FACE[side].name}`, () => o.onGuess(side));
      b.dataset.side = side;
      row.append(b);
    }
  } else if (st.s === 'flipping') {
    msg.textContent = `猜「${COIN_FACE[st.guess].name}」……硬幣轉啊轉～`;
  } else if (st.s === 'result') {
    const net = st.coins >= 0 ? `🪙 +${st.coins}` : `🪙 ${st.coins}`;
    msg.textContent = `是${COIN_FACE[st.result].name}！${st.win ? '猜中了！' : '沒猜中…'} ${net}${st.gain > 0 ? `　❤ +${st.gain}` : ''}\n${o.herName}：「${st.line}」`;
    row.append(button(doc, '🔁 再玩一次', o.onAgain, { disabled: o.coins < o.cost }), button(doc, '👋 不玩了', o.onQuit));
  } else {
    msg.textContent = `${o.herName}：「${st.line}」`;
    row.append(button(doc, '👋 好吧', o.onQuit));
  }
  root.append(msg, row);
  root.append(el(doc, 'div', 'px-hint', '正反面一半一半，由遊戲主機決定（不是畫面）。猜中的好感每天有上限，金幣不夠時投不了幣。'));
  return root;
}

// ───────────── 比大小 ─────────────
/**
 * 比大小的狀態機：
 *   pick（選對手；只有一個人時跳過）──▶ ready ──發牌──▶ dealing ──host 回結果──▶ result ──再一把──▶ dealing
 *                                                                                └──換人──▶ pick
 */
export type CardState =
  | { s: 'pick' }
  | { s: 'ready'; npc: string }
  | { s: 'dealing'; npc: string }
  | { s: 'result'; npc: string; mine: number; theirs: number; outcome: 'win' | 'lose' | 'tie'; gain: number; line: string };

export interface CardOpponent { id: string; name: string; emoji: string; hearts: number; wins: number }

const RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

function card(doc: Document, rank: number | null, seed: number, who: string): HTMLElement {
  const c = el(doc, 'div', `px-card${rank === null ? ' back' : ''}`);
  if (rank !== null) {
    const suit = SUITS[seed % 4]!;
    c.classList.toggle('red', suit === '♥' || suit === '♦');
    c.append(el(doc, 'span', 'rank', RANK[rank]!), el(doc, 'span', 'suit', suit));
  }
  const box = el(doc, 'div', 'px-card-slot');
  box.append(c, el(doc, 'div', 'px-card-who', who));
  return box;
}

export function buildCards(doc: Document, o: {
  state: CardState; opponents: CardOpponent[]; maxWins: number; friendship: number; herName: string;
  onPick(id: string): void; onDeal(): void; onSwitch(): void; onQuit(): void;
}): HTMLElement {
  const root = el(doc, 'div', 'px-shop px-cards');
  const st = o.state;
  root.dataset.state = st.s;
  if (st.s === 'pick') {
    root.append(el(doc, 'div', 'px-arcade-msg', '要跟誰比大小？抽到大的牌就贏（A 最小、K 最大）。'));
    const list = el(doc, 'div', 'px-arcade-btns');
    for (const op of o.opponents) {
      const b = button(doc, `${op.emoji} ${op.name} ${'❤'.repeat(op.hearts)}`, () => o.onPick(op.id));
      b.dataset.npc = op.id;
      list.append(b);
    }
    root.append(list);
    root.append(el(doc, 'div', 'px-hint', `贏了對方好感 +${o.friendship}（每個人一天最多算 ${o.maxWins} 次）。晚上 8 點以後，鎮上的人都會來酒館。`));
    return root;
  }
  const op = o.opponents.find((x) => x.id === st.npc);
  const name = op?.name ?? st.npc;
  root.append(el(doc, 'div', 'px-arcade-head', `${op?.emoji ?? '🙂'} 對手：${name}　今天贏了 ${op?.wins ?? 0}／${o.maxWins} 次`));
  const table = el(doc, 'div', 'px-card-table');
  const seed = st.s === 'result' ? st.mine * 7 + st.theirs * 3 : 0;
  table.append(
    card(doc, st.s === 'result' ? st.mine : null, seed, '主人'),
    el(doc, 'div', 'px-card-vs', st.s === 'dealing' ? '…' : 'VS'),
    card(doc, st.s === 'result' ? st.theirs : null, seed + 1, name),
  );
  if (st.s === 'dealing') table.classList.add('dealing');
  root.append(table);
  const msg = el(doc, 'div', 'px-arcade-msg');
  const row = el(doc, 'div', 'px-arcade-btns');
  if (st.s === 'ready') {
    msg.textContent = `${name}：「來吧，洗好牌了。」\n抽到大的牌就贏（A 最小、K 最大）`;
    row.append(button(doc, '🃏 發牌', o.onDeal));
  } else if (st.s === 'dealing') {
    msg.textContent = '發牌中……';
  } else {
    const verdict = st.outcome === 'win' ? '你贏了！' : st.outcome === 'lose' ? '你輸了…' : '平手！';
    msg.textContent = `${RANK[st.mine]} 對 ${RANK[st.theirs]}，${verdict}${st.gain > 0 ? `　${name} 好感 +${st.gain}` : st.outcome === 'win' ? '（今天的好感算滿了）' : ''}\n${name}：「${st.line}」`;
    row.append(button(doc, '🃏 再一把', o.onDeal));
    if (o.opponents.length > 1) row.append(button(doc, '🔄 換人', o.onSwitch));
  }
  row.append(button(doc, '👋 不玩了', o.onQuit));
  root.append(msg, row);
  return root;
}
