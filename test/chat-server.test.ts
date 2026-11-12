// V0.22：聊天室參考伺服器（scripts/chat-server.ts）＋ 遊戲的 ChatService 真的連上去
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startChatServer } from '../scripts/chat-server.ts';
import { ChatService } from '../src/client/chat.ts';
import social from '../packs/whale-girl-pixel/social.json' with { type: 'json' };
import type { SocialFile } from '../src/shared/trade.ts';

const S = social as unknown as SocialFile;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('等太久'); await wait(20); }
}

test('兩個玩家連上同一台伺服器：互相看到對方的話、髒話被遮、太快被擋、離開有通知', async () => {
  const logs: string[] = [];
  const srv = startChatServer({ port: 0, social: S, log: (l) => logs.push(l) });
  const port = await srv.ready;
  let now = 1_000_000;
  const a = new ChatService(S.chat, { store: null, nick: () => '小明', now: () => now });
  const b = new ChatService(S.chat, { store: null, nick: () => '阿華', now: () => now });
  try {
    assert.equal(await a.connectToServer(`ws://127.0.0.1:${port}`), true);
    assert.equal(await b.connectToServer(`ws://127.0.0.1:${port}`), true);
    await until(() => srv.online() === 2);
    await until(() => a.messages().some((m) => m.text.includes('阿華 進入了聊天室')));

    assert.deepEqual(a.send('大家好，我是小明'), { ok: true });
    await until(() => b.messages().some((m) => m.from === 'server' && m.text === '大家好，我是小明'));
    assert.equal(b.messages().find((m) => m.text === '大家好，我是小明')!.nick, '小明');
    // 自己的話不會被伺服器再送回來一次
    await wait(100);
    assert.equal(a.messages().filter((m) => m.text === '大家好，我是小明').length, 1);
    // 伺服器模式不會有模擬的居民回話
    assert.equal(a.messages().some((m) => m.from === 'bot'), false);

    now += 2000;
    assert.ok(b.send('你好白痴').ok);
    await until(() => a.messages().some((m) => m.from === 'server' && m.nick === '阿華'));
    assert.equal(a.messages().filter((m) => m.nick === '阿華').at(-1)!.text, '你好＊＊');

    // 不守規矩的客戶端（直接用 WebSocket，不經過 ChatService）：伺服器自己也會擋
    const raw = new WebSocket(`ws://127.0.0.1:${port}`);
    const got: string[] = [];
    raw.onmessage = (e) => got.push(String(e.data));
    await new Promise((r) => (raw.onopen = r));
    raw.send(JSON.stringify({ type: 'hello', nick: '壞蛋白痴' + 'x'.repeat(50) }));
    raw.send(JSON.stringify({ type: 'chat', text: 'y'.repeat(500) }));
    raw.send(JSON.stringify({ type: 'chat', text: '第二句馬上送' }));
    raw.send('不是 JSON');
    await until(() => got.some((g) => g.includes('說太快了')));
    await until(() => a.messages().some((m) => m.text.startsWith('yyy')));
    const longMsg = a.messages().find((m) => m.text.startsWith('yyy'))!;
    assert.equal(longMsg.text.length, S.chat.maxLength, '伺服器截長度');
    assert.ok(!longMsg.nick.includes('白痴') && longMsg.nick.length <= S.nick.maxLength, `暱稱被清過：${longMsg.nick}`);
    assert.equal(a.messages().some((m) => m.text === '第二句馬上送'), false, '太快的那句沒有廣播');
    raw.close();
    await until(() => a.messages().some((m) => /離開了聊天室/.test(m.text)));

    // 新進來的人看得到最近的紀錄
    const c = new ChatService(S.chat, { store: null, nick: () => '晚到的人' });
    assert.equal(await c.connectToServer(`ws://127.0.0.1:${port}`), true);
    await until(() => c.messages().some((m) => m.text === '大家好，我是小明'));
    c.dispose();
  } finally {
    a.dispose();
    b.dispose();
    await srv.close();
  }
  // 伺服器關掉，客戶端自動回到本地模擬
  assert.ok(logs.some((l) => l.startsWith('[join]')));
});

test('伺服器關掉時，客戶端退回本地模擬', async () => {
  const srv = startChatServer({ port: 0, social: S, log: () => {} });
  const port = await srv.ready;
  const a = new ChatService(S.chat, { store: null, nick: () => '小明' });
  assert.equal(await a.connectToServer(`ws://127.0.0.1:${port}`), true);
  assert.equal(a.mode, 'server');
  await srv.close();
  await until(() => a.mode === 'local');
  assert.match(a.messages().at(-1)!.text, /斷線|本地模擬/);
  a.dispose();
});
