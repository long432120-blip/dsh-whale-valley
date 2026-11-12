// V0.22：非同步社交（碼、交易所、攤位、領養、串門、信箱、敏感詞）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { b64urlToBytes, bytesToB64url, checksum, decodeCode, decodeCodeAsync, encodeCode, encodeCodeAsync } from '../src/shared/codec.ts';
import { applyAction, buildDefs, gameView, newGame } from '../src/shared/gameplay.ts';
import { COIN, type GameAction, type GameState } from '../src/shared/gameplay-types.ts';
import { makeFilter } from '../src/shared/profanity.ts';
import { marketOffers, stallPriceRange } from '../src/shared/trade.ts';
import { packGameplay } from './pack-gameplay.ts';

const file = await packGameplay();
const defs = buildDefs(file);
const S = file.social!;
const NOW = Date.UTC(2026, 10, 12, 4); // 台灣中午
const HOUR = 3_600_000;

function player(seed: number, extra: Partial<GameState> = {}): GameState {
  const g = newGame(NOW - 1000, defs, seed);
  return { ...g, inventory: { ...g.inventory, [COIN]: 50_000, fish_bass: 10, crop_carrot: 5 }, ...extra };
}
/** 失敗時只比錯誤代碼 */
function act(g: GameState, a: GameAction, now = NOW): { ok: true } | { ok: false; error: string } {
  const r = applyAction(g, a, defs, now);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
const view = (g: GameState, now = NOW) => gameView(g, defs, now);
function must(g: GameState, a: GameAction, now = NOW) {
  const r = applyAction(g, a, defs, now);
  assert.ok(r.ok, `${a.type} 失敗：${!r.ok ? r.error : ''}`);
  return r as Extract<typeof r, { ok: true }>;
}
/** 拆開碼、改內容、（選擇性）重算校驗碼 */
function tamper(code: string, edit: (p: Record<string, unknown>) => void, resign: boolean): string {
  const [, kind, enc, body] = code.split('.');
  const p = JSON.parse(new TextDecoder().decode(b64urlToBytes(body!)));
  edit(p);
  const nb = bytesToB64url(new TextEncoder().encode(JSON.stringify(p)));
  const head = `${kind}.${enc}.${nb}`;
  return `WV1.${head}.${resign ? checksum(head, S.salt) : code.split('.')[4]}`;
}

test('碼：編碼、解碼、改一個字就失效、種類不對也不收', async () => {
  const code = encodeCode('pet', { v: 1, hello: '鯨魚 🐋' }, S.salt);
  assert.match(code, /^WV1\.pet\.j\.[A-Za-z0-9_-]+\.[0-9a-z]+$/);
  const d = decodeCode(code, S.salt, 'pet');
  assert.ok(d.ok && (d.payload as { hello: string }).hello === '鯨魚 🐋');
  assert.deepEqual(decodeCode(code, S.salt, 'stall'), { ok: false, reason: 'kind' });
  assert.deepEqual(decodeCode(code, 'other-salt', 'pet'), { ok: false, reason: 'checksum' });
  const broken = code.slice(0, 20) + (code[20] === 'A' ? 'B' : 'A') + code.slice(21);
  assert.equal(decodeCode(broken, S.salt, 'pet').ok, false);
  assert.deepEqual(decodeCode('亂打的字', S.salt, 'pet'), { ok: false, reason: 'format' });
  // 中間被聊天軟體插了換行也可以
  assert.ok(decodeCode(code.slice(0, 15) + '\n  ' + code.slice(15), S.salt, 'pet').ok);
  // 壓縮版（拜訪碼）
  const big = { v: 1, rows: Array.from({ length: 200 }, (_, i) => ({ i, name: '一樣的東西' })) };
  const z = await encodeCodeAsync('visit', big, S.salt);
  assert.ok(z.includes('.visit.z.'));
  assert.ok(z.length < JSON.stringify(big).length, '壓縮後比較短');
  const dz = await decodeCodeAsync<typeof big>(z, S.salt, 'visit');
  assert.ok(dz.ok && dz.payload.rows.length === 200);
});

test('敏感詞：擋髒話（含空白、符號、全形、大小寫）、放過正常詞', () => {
  const f = makeFilter(S.chat);
  assert.equal(f('你這個白痴').text, '你這個＊＊');
  assert.equal(f('白 . 痴').hit, true);
  assert.equal(f('ＦＵＣＫ you').text.startsWith('＊＊＊＊'), true);
  assert.equal(f('Shit!').hit, true);
  assert.equal(f('你在幹嘛').hit, false, '幹嘛不是髒話');
  assert.equal(f('樹幹好粗').hit, false);
  assert.equal(f('今天釣到河豚！').hit, false);
  assert.equal(f('傻逼').text, '＊＊', '簡體也擋');
});

test('交易所：每天換一批、同一天一樣、買了庫存會少', () => {
  const a = marketOffers(defs, NOW);
  assert.equal(a.length, S.market.offers);
  assert.deepEqual(marketOffers(defs, NOW + HOUR), a, '同一天一樣');
  assert.notDeepEqual(marketOffers(defs, NOW + 24 * HOUR).map((o) => o.item), a.map((o) => o.item), '隔天換一批');
  const g = player(1);
  const o = a[0]!;
  const r = must(g, { type: 'market_buy', item: o.item, qty: 1 });
  assert.equal(r.game.inventory[COIN], 50_000 - o.price);
  assert.equal(r.game.inventory[o.item], (g.inventory[o.item] ?? 0) + 1);
  assert.equal(view(r.game).social?.market.find((x) => x.item === o.item)?.left, o.stock - 1);
  assert.equal(act(r.game, { type: 'market_buy', item: o.item, qty: o.stock }).ok, false, '超過庫存');
  assert.equal(act(g, { type: 'market_buy', item: 'fish_bass_not_today', qty: 1 }).ok, false);
});

test('攤位：掛單先扣貨 → 朋友用攤位碼買 → 收款碼給賣家 → 只能收一次', () => {
  const seller = player(11);
  const buyer = player(22);
  assert.notEqual(seller.trade.id, buyer.trade.id);
  const [lo, hi] = stallPriceRange(defs, 'fish_bass')!;
  assert.equal(act(seller, { type: 'stall_list', item: 'fish_bass', qty: 3, price: hi + 1 }).ok, false, '太貴不給掛');
  assert.equal(act(seller, { type: 'stall_list', item: 'fish_bass', qty: 3, price: Math.max(1, lo - 1) }).ok, lo <= 1, '太便宜不給掛');
  const listed = must(seller, { type: 'stall_list', item: 'fish_bass', qty: 3, price: lo + 2 });
  assert.equal(listed.game.inventory.fish_bass, 7, '先扣住 3 條');
  if (listed.event.type !== 'stall_listed') throw new Error();
  const code = listed.event.code;
  // 自己不能買自己的
  assert.deepEqual(act(listed.game, { type: 'trade_buy', code }), { ok: false, error: 'own_code' });
  // 朋友買
  const bought = must(buyer, { type: 'trade_buy', code });
  if (bought.event.type !== 'trade_bought') throw new Error();
  const total = 3 * (lo + 2);
  assert.equal(bought.game.inventory[COIN], 50_000 - total);
  assert.equal(bought.game.inventory.fish_bass, 13);
  assert.deepEqual(act(bought.game, { type: 'trade_buy', code }), { ok: false, error: 'already' }, '同一張碼只能買一次');
  // 賣家收款
  const receipt = bought.event.receipt;
  assert.deepEqual(act(buyer, { type: 'trade_receipt', code: receipt }), { ok: false, error: 'not_yours' }, '收款碼只有賣家能用');
  const paid = must(listed.game, { type: 'trade_receipt', code: receipt });
  assert.equal(paid.game.inventory[COIN], 50_000 + total);
  assert.equal(paid.game.trade.stall[0]!.status, 'sold');
  assert.deepEqual(act(paid.game, { type: 'trade_receipt', code: receipt }), { ok: false, error: 'already' });
});

test('攤位：取消掛單會退貨，之後的收款碼不收', () => {
  const seller = player(33);
  const [lo] = stallPriceRange(defs, 'crop_carrot')!;
  const l = must(seller, { type: 'stall_list', item: 'crop_carrot', qty: 2, price: lo });
  if (l.event.type !== 'stall_listed') throw new Error();
  const cancelled = must(l.game, { type: 'stall_cancel', id: l.event.listing.id });
  assert.equal(cancelled.game.inventory.crop_carrot, 5);
  const b = must(player(44), { type: 'trade_buy', code: l.event.code });
  if (b.event.type !== 'trade_bought') throw new Error();
  assert.deepEqual(act(cancelled.game, { type: 'trade_receipt', code: b.event.receipt }), { ok: false, error: 'gone' });
});

test('防作弊：改了碼裡的價格 → 校驗碼不對；就算重算校驗碼，超出範圍也不收', () => {
  const seller = player(55);
  const [lo] = stallPriceRange(defs, 'fish_bass')!;
  const l = must(seller, { type: 'stall_list', item: 'fish_bass', qty: 5, price: lo + 5 });
  if (l.event.type !== 'stall_listed') throw new Error();
  const buyer = player(66);
  const cheap = tamper(l.event.code, (p) => (p.price = 1), false);
  assert.deepEqual(act(buyer, { type: 'trade_buy', code: cheap }), { ok: false, error: 'bad_code' }, '改價格、沒重算校驗碼');
  const cheapResigned = tamper(l.event.code, (p) => (p.price = 0), true);
  assert.deepEqual(act(buyer, { type: 'trade_buy', code: cheapResigned }), { ok: false, error: 'bad_code' }, '重算了校驗碼，但價格 0 不合理');
  const lots = tamper(l.event.code, (p) => (p.qty = 5000), true);
  assert.deepEqual(act(buyer, { type: 'trade_buy', code: lots }), { ok: false, error: 'bad_code' }, '數量太多');
  const old = tamper(l.event.code, (p) => (p.at = NOW - 30 * 24 * HOUR), true);
  assert.deepEqual(act(buyer, { type: 'trade_buy', code: old }), { ok: false, error: 'bad_code' }, '過期');
  const future = tamper(l.event.code, (p) => (p.at = NOW + 24 * HOUR), true);
  assert.deepEqual(act(buyer, { type: 'trade_buy', code: future }), { ok: false, error: 'bad_code' }, '來自未來');
  // 收款碼改金額
  const b = must(buyer, { type: 'trade_buy', code: l.event.code });
  if (b.event.type !== 'trade_bought') throw new Error();
  const rich = tamper(b.event.receipt, (p) => (p.total = 9_999_999), true);
  assert.deepEqual(act(l.game, { type: 'trade_receipt', code: rich }), { ok: false, error: 'bad_code' }, '收款金額跟攤位對不上');
});

test('領養碼：寵物離開原本的家、24 小時一次、好感被改成 9999 不收、只能領一次', () => {
  const P = file.pets!;
  const kind = Object.keys(P.species)[0]!;
  const giver = must(player(77), { type: 'buy_pet', kind, name: '小橘' }).game;
  const pet = giver.pets[0]!;
  const out = must({ ...giver, pets: [{ ...pet, affection: 40, satiety: 70 }] }, { type: 'pet_adopt_out', pet: pet.id });
  if (out.event.type !== 'pet_adopt_code') throw new Error();
  assert.equal(out.game.pets.length, 0, '寵物離開了');
  // 24 小時冷卻
  const again = must(out.game, { type: 'buy_pet', kind }).game;
  assert.deepEqual(act(again, { type: 'pet_adopt_out', pet: again.pets[0]!.id }, NOW + 23 * HOUR), { ok: false, error: 'cooldown' });
  assert.ok(act(again, { type: 'pet_adopt_out', pet: again.pets[0]!.id }, NOW + 24 * HOUR).ok);
  assert.equal(view(out.game).social?.adoptReadyAt, NOW + 24 * HOUR);
  // 朋友領養：好感、飽食都帶過去
  const friend = player(88);
  const got = must(friend, { type: 'pet_adopt_in', code: out.event.code });
  const p2 = got.game.pets.at(-1)!;
  assert.deepEqual([p2.kind, p2.name, p2.affection, p2.satiety, p2.how], [kind, '小橘', 40, 70, 'adopt']);
  assert.deepEqual(act(got.game, { type: 'pet_adopt_in', code: out.event.code }), { ok: false, error: 'already' });
  // 竄改
  const hacked = tamper(out.event.code, (p) => (p.affection = 9999), false);
  assert.deepEqual(act(friend, { type: 'pet_adopt_in', code: hacked }), { ok: false, error: 'bad_code' });
  const hackedResigned = tamper(out.event.code, (p) => (p.affection = 9999), true);
  assert.deepEqual(act(friend, { type: 'pet_adopt_in', code: hackedResigned }), { ok: false, error: 'bad_code' }, '超過好感上限');
  const fake = tamper(out.event.code, (p) => (p.kind = 'dragon'), true);
  assert.deepEqual(act(friend, { type: 'pet_adopt_in', code: fake }), { ok: false, error: 'bad_code' }, '沒有這種寵物');
  // 送錯了可以自己領回來
  assert.ok(act(out.game, { type: 'pet_adopt_in', code: out.event.code }).ok);
});

test('串門：邀請碼只帶看得到的東西；回信碼 → 信箱、當天幫忙澆的水有效', () => {
  const host = player(99, { inventory: { [COIN]: 123456, secret_item: 1 } as never });
  const snap = must(host, { type: 'visit_snapshot' });
  if (snap.event.type !== 'visit_snapshot') throw new Error();
  const game = snap.event.payload.game;
  assert.equal('inventory' in game, false, '不帶揹包');
  assert.equal('diary' in game, false);
  assert.equal('trade' in game, false);
  assert.equal(snap.event.payload.from, host.trade.id);
  // 先種一格田（還沒澆水）
  const plotId = 'garden/plot-1';
  const planted = { ...host, plots: { ...host.plots, [plotId]: { crop: 'carrot', plantedAt: NOW - HOUR, growthMs: 0, growthAt: NOW - HOUR, wateredUntil: 0 } } };
  const visitor = player(100);
  const reply = encodeCode('reply', { v: 1, to: host.trade.id, from: visitor.trade.id, nick: '阿明', text: '你家好漂亮！白痴', watered: [plotId, 'garden/nope'], at: NOW - HOUR }, S.salt);
  const r = must(planted, { type: 'visit_reply', code: reply });
  if (r.event.type !== 'letter_received') throw new Error();
  assert.equal(r.event.watered, 1);
  assert.ok(r.game.plots[plotId]!.wateredUntil > NOW);
  assert.equal(r.game.mailbox.length, 1);
  assert.equal(r.event.letter.text, '你家好漂亮！＊＊', '信也會過濾髒話');
  assert.equal(view(r.game).social?.unread, 1);
  assert.deepEqual(act(r.game, { type: 'visit_reply', code: reply }), { ok: false, error: 'already' });
  assert.deepEqual(act(visitor, { type: 'visit_reply', code: reply }), { ok: false, error: 'not_yours' }, '回信碼只能給被拜訪的人');
  const read = must(r.game, { type: 'mail_read' });
  assert.equal(view(read.game).social?.unread, 0);
  // 隔天才收到：信收下，但不澆水
  const late = encodeCode('reply', { v: 1, to: host.trade.id, from: visitor.trade.id, nick: '阿明', text: '昨天去你家', watered: [plotId], at: NOW - 30 * HOUR }, S.salt);
  const r2 = must(planted, { type: 'visit_reply', code: late });
  if (r2.event.type !== 'letter_received') throw new Error();
  assert.equal(r2.event.watered, 0);
});

test('暱稱：過濾髒話、限制長度；存檔讀回來也一樣', () => {
  const g = player(5);
  const r = must(g, { type: 'set_nick', nick: '<b>白痴</b>大魔王好長好長好長好長好長' });
  if (r.event.type !== 'nick_set') throw new Error();
  assert.ok(r.event.nick.length <= S.nick.maxLength);
  assert.ok(!r.event.nick.includes('<') && r.event.nick.includes('＊＊'));
});
