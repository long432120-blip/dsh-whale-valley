// V0.22：瀏覽器端的社交模組（串門的 VisitBridge、繁簡轉換、聊天室）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, buildDefs, newGame } from '../src/shared/gameplay.ts';
import { COIN, type GameState } from '../src/shared/gameplay-types.ts';
import { decodeInvite, encodeInvite, VisitBridge } from '../src/client/visit.ts';
import { I18nManager } from '../src/client/i18n.ts';
import { ChatService } from '../src/client/chat.ts';
import zhTW from '../locales/zh-TW.json' with { type: 'json' };
import zhCN from '../locales/zh-CN.json' with { type: 'json' };
import t2s from '../locales/t2s-chars.json' with { type: 'json' };
import { packGameplay } from './pack-gameplay.ts';

const file = await packGameplay();
const defs = buildDefs(file);
const S = file.social!;
const NOW = Date.now();
const HOUR = 3_600_000;

function host(): GameState {
  const g = newGame(NOW - HOUR, defs, 4242);
  return {
    ...g,
    inventory: { ...g.inventory, [COIN]: 99999 },
    plots: { ...g.plots, 'garden/plot-1': { crop: 'carrot', plantedAt: NOW - HOUR, growthMs: 0, growthAt: NOW - HOUR, wateredUntil: 0 } },
  };
}

test('串門：邀請碼 → 唯讀的朋友家；只能澆水；回信碼帶著澆過的田', async () => {
  const h = host();
  const snap = applyAction(h, { type: 'visit_snapshot' }, defs, NOW);
  assert.ok(snap.ok && snap.event.type === 'visit_snapshot');
  const code = await encodeInvite(snap.event.payload, S.salt);
  assert.ok(code.length < 4000, `邀請碼長度 ${code.length}`);
  assert.equal((await decodeInvite(code, S.salt, 30, h.trade.id, NOW)).ok, false, '不能拜訪自己');
  assert.deepEqual(await decodeInvite(code.replace('.z.', '.j.'), S.salt, 30, 'tother', NOW), { ok: false, reason: 'checksum' });
  assert.deepEqual(await decodeInvite(code, S.salt, 30, 'tother', NOW + 31 * 24 * HOUR), { ok: false, reason: 'expired' });
  const inv = await decodeInvite(code, S.salt, 30, 'tother', NOW);
  assert.ok(inv.ok);
  const vb = new VisitBridge(inv.payload, file, { id: 'tvisitor1', nick: '阿華' }, S.salt, () => NOW + 60_000);
  const v = await vb.visit();
  assert.equal(v.game?.coins, 0, '看不到主人的錢');
  assert.ok(v.game?.plots['garden/plot-1'], '看得到主人的田');
  const sell = await vb.act({ type: 'sell', item: 'fish_bass', qty: 1 } as never);
  assert.deepEqual([sell.ok, !sell.ok && sell.error], [false, 'visitor']);
  assert.deepEqual([(await vb.act({ type: 'harvest', plot: 'garden/plot-1' } as never)).ok], [false]);
  const w = await vb.act({ type: 'water', plot: 'garden/plot-1' });
  assert.ok(w.ok, '可以幫忙澆水');
  assert.equal(vb.wateredCount, 1);
  // 回信碼 → 主人兌換：信 + 澆水
  const reply = vb.makeReply('  你家好漂亮！\n下次見  ');
  const r = applyAction(h, { type: 'visit_reply', code: reply }, defs, NOW + 2 * 60_000);
  assert.ok(r.ok && r.event.type === 'letter_received');
  if (r.ok && r.event.type === 'letter_received') {
    assert.equal(r.event.letter.text, '你家好漂亮！ 下次見');
    assert.equal(r.event.letter.nick, '阿華');
    assert.equal(r.event.watered, 1);
  }
});

test('繁簡：語言包 key、兩岸用語、逐字轉換、打字機逐字出現也對', () => {
  const data = { 'zh-TW': zhTW as never, 'zh-CN': zhCN as never, pairs: (t2s as { pairs: string }).pairs };
  const tw = new I18nManager(data, 'zh-TW');
  const cn = new I18nManager(data, 'zh-CN');
  assert.equal(tw.t('settings.title'), '⚙️ 設定');
  assert.equal(cn.t('settings.title'), '⚙️ 设置');
  assert.equal(cn.t('market.coins', { n: 12 }), '🪙 金币 12');
  assert.equal(cn.t('no.such.key'), 'no.such.key');
  assert.equal(tw.convert('程式碼'), '程式碼', '繁體不轉');
  assert.equal(cn.convert('程式碼、網路、預設、存檔、外掛'), '代码、网络、默认、存档、插件');
  assert.equal(cn.convert('打開揹包看看鯨魚娘的釣竿'), '打开背包看看鲸鱼娘的钓竿');
  assert.equal(cn.convert('牠說「你好喔」'), '它说“你好哦”');
  // 打字機：先出現「網」再出現「網路」：先被逐字轉成「网」，整句時還是要換成「网络」
  assert.equal(cn.convert(cn.convert('網') + '路'), '网络');
  assert.equal(cn.convert('Hello 123'), 'Hello 123');
  assert.equal(I18nManager.detect({ getItem: () => null }, { language: 'zh-CN' }), 'zh-CN');
  assert.equal(I18nManager.detect({ getItem: () => null }, { language: 'zh-TW' }), 'zh-TW');
  assert.equal(I18nManager.detect({ getItem: () => 'zh-TW' }, { language: 'zh-CN' }), 'zh-TW', '選過的優先');
  // 兩個語言包的 key 一樣多
  assert.deepEqual(Object.keys((zhCN as { ui: object }).ui).sort(), Object.keys((zhTW as { ui: object }).ui).sort());
});

test('聊天室：過濾髒話、太快不給送、同一句不能洗版、關鍵字回覆、紀錄存起來', () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  let now = 1_000_000;
  const chat = new ChatService(S.chat, { store, now: () => now, rnd: () => 0, nick: () => '小明' });
  assert.deepEqual(chat.send('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(chat.send('你好白痴'), { ok: true });
  assert.equal(chat.messages().at(-1)!.text, '你好＊＊');
  assert.equal(chat.messages().at(-1)!.nick, '小明');
  assert.deepEqual(chat.send('再一句'), { ok: false, reason: 'too_fast' });
  now += 2000;
  assert.deepEqual(chat.send('你好白痴'), { ok: false, reason: 'repeat' });
  now += 11_000;
  assert.ok(chat.send('x'.repeat(500)).ok);
  assert.equal(chat.messages().at(-1)!.text.length, S.chat.maxLength);
  assert.match(chat.replyFor('今天去釣魚'), /魚|釣|女神|河豚|龍蝦/);
  const r1 = chat.replyFor('今天去釣魚');
  assert.notEqual(chat.replyFor('今天去釣魚', r1), r1, '兩個人回同一則，不會講一樣的話');
  const again = new ChatService(S.chat, { store, now: () => now });
  assert.equal(again.messages().length, 2, '重新整理後紀錄還在');
  chat.dispose();
  again.dispose();
});

test('聊天室：connectToServer 只接受 ws/wss；連不上自動回到本地模擬', async () => {
  const chat = new ChatService(S.chat, { store: null });
  assert.equal(await chat.connectToServer('http://example.com'), false);
  assert.equal(chat.mode, 'local');
  // 假的 WebSocket：一建立就出錯
  class FailWS { onerror: (() => void) | null = null; onopen = null; onclose = null; onmessage = null; readyState = 0;
    constructor() { setTimeout(() => this.onerror?.(), 5); } close() {} send() {} }
  const c2 = new ChatService(S.chat, { store: null, WebSocketImpl: FailWS as never });
  assert.equal(await c2.connectToServer('wss://example.com/chat'), false);
  assert.equal(c2.mode, 'local');
  assert.match(c2.messages().at(-1)!.text, /本地模擬/);
  // 假的 WebSocket：連上、收到訊息（訊息也會被過濾）
  class OkWS { onerror = null; onopen: (() => void) | null = null; onclose = null; onmessage: ((e: { data: string }) => void) | null = null; readyState = 1; sent: string[] = [];
    constructor() { setTimeout(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ type: 'chat', nick: '路人', text: '哈囉白痴', at: 1 }) }); }, 5); }
    close() {} send(s: string) { this.sent.push(s); } }
  const c3 = new ChatService(S.chat, { store: null, WebSocketImpl: OkWS as never });
  assert.equal(await c3.connectToServer('wss://example.com/chat'), true);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(c3.mode, 'server');
  assert.equal(c3.messages().at(-1)!.text, '哈囉＊＊');
  chat.dispose(); c2.dispose(); c3.dispose();
});
