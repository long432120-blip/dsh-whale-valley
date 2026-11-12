// V0.17：鯨魚娘的像素日記：今天的紀錄 → 睡覺時拼一篇 → host 請 AI 重寫（50 字以內）
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { packGameplay } from './pack-gameplay.ts';
import { applyAction, buildDefs, gameView, newGame, normalizeGame, validateGameplay } from '../src/shared/gameplay.ts';
import type { GameEvent, GameState } from '../src/shared/gameplay-types.ts';
import {
  charLen, DIARY_FACTS, DIARY_PENDING_MS, dayFacts, diaryPrompt, emptyLog, logEvent, markDiaryPending, normalizeDiary, setDiaryText, templateDiary, validateDiary,
  type DiaryFile,
} from '../src/shared/diary.ts';
import { buildDiaryMessages, type AiFile } from '../src/shared/ai.ts';
import { WhaleAi } from '../src/host/ai.ts';
import type { ResolvedAiConfig } from '../src/host/ai-config.ts';
import { rngFrom } from '../src/shared/gameplay.ts';

const root = join(import.meta.dirname, '..');
const aiFile = JSON.parse(await readFile(join(root, 'packs/whale-girl-pixel/ai.json'), 'utf8')) as AiFile;
const file = await packGameplay();
const defs = buildDefs(file);
const D = file.diary!;
const T0 = new Date(2026, 10, 10, 15, 0).getTime();

const ev = (e: unknown) => e as GameEvent;
const caught = (item: string, extra: object = {}) => ev({ type: 'caught', item, count: 1, first: false, rewards: [], rarity: 'common', ...extra });

test('diary.json 通過檢查；寫錯會被抓到', () => {
  assert.deepEqual(validateGameplay(file), []);
  assert.deepEqual(validateDiary(D), []);
  const bad = { ...D, maxChars: 3, facts: { ...D.facts, fish: '' }, closers: [] } as DiaryFile;
  const errs = validateDiary(bad).join('\n');
  assert.match(errs, /maxChars/);
  assert.match(errs, /fish/);
  assert.match(errs, /closers/);
});

test('今天的紀錄：釣魚、種菜、收成、餵食、升級都記下來；不重要的動作不記', () => {
  let log = emptyLog(T0);
  log = logEvent(log, caught('fish_bass'), defs);
  log = logEvent(log, caught('fish_bass'), defs);
  log = logEvent(log, caught('fish_carp', { first: true }), defs);
  log = logEvent(log, ev({ type: 'planted', plot: 'p1', crop: 'carrot', seed: 'seed_carrot' }), defs);
  log = logEvent(log, ev({ type: 'planted', plot: 'p2', crop: 'carrot', seed: 'seed_carrot' }), defs);
  log = logEvent(log, ev({ type: 'harvested', plot: 'p3', item: 'crop_tomato', count: 4 }), defs);
  log = logEvent(log, ev({ type: 'fed', item: 'food_pancake', gain: 6, liked: true, disliked: false, capped: false, satiety: 30, stamina: 15, levelUp: '好朋友' }), defs);
  log = logEvent(log, ev({ type: 'gear_set', slot: 'rod', item: 'x' }), defs);
  assert.equal(log.counts.fish, 3);
  assert.equal(log.counts.firstFish, 1);
  assert.equal(log.counts.planted, 2);
  assert.equal(log.counts.harvested, 4);
  assert.equal(log.counts.levelUp, 1);
  assert.equal(Object.keys(log.counts).length, 6);
  const facts = dayFacts(log, defs, D).map((f) => f.text);
  // 照重要程度排：第一次釣到、升級 在 釣魚、收成 前面
  assert.match(facts[0]!, /第一次釣到/);
  assert.match(facts[1]!, /好朋友/);
  assert.ok(facts.some((f) => /釣到3條魚，有.+/.test(f)), facts.join('｜'));
  assert.ok(facts.some((f) => /收成了4個/.test(f)));
  assert.ok(facts.some((f) => /種了2顆/.test(f)));
  assert.ok(facts.some((f) => /鬆餅/.test(f)));
  // 釣到垃圾不算魚
  assert.deepEqual(logEvent(emptyLog(T0), caught('junk_can', { first: true }), defs).counts, {});
  // 只釣到一條、而且是第一次：不重複寫
  const one = logEvent(emptyLog(T0), caught('fish_carp', { first: true }), defs);
  assert.deepEqual(dayFacts(one, defs, D).map((f) => f.key), ['firstFish']);
});

test('拼出來的日記：開頭有季節天氣、最多兩件事，永遠不超過 50 字', () => {
  const rng = rngFrom(42);
  const all = DIARY_FACTS.map((k) => ({ key: k, text: D.facts[k].replace('{n}', '12').replace(/\{\w+\}/g, '超級長名字的傳說之魚') }));
  for (let i = 0; i < 300; i++) {
    const n = i % 5;
    const facts = all.slice(i % all.length, (i % all.length) + n);
    for (const w of ['sunny', 'rainy', 'storm', 'fog']) {
      const t = templateDiary(facts, { date: '冬季第2天', weatherId: w, weatherName: '霧' }, D, () => rng.next());
      assert.ok(charLen(t) <= D.maxChars, `${charLen(t)}：${t}`);
      assert.ok(t.includes(D.weather[w] ?? '霧。'), t);
    }
  }
  const empty = templateDiary([], { date: '春季第1天', weatherId: 'sunny', weatherName: '晴天' }, D, () => 0);
  assert.match(empty, /^今天天氣很好。/);
  assert.ok(D.empty.some((x) => empty.includes(x)));
});

test('睡覺：今天的紀錄變成一篇日記、紀錄歸零；看過可以收好', () => {
  let g: GameState = { ...newGame(T0, defs, 3), inventory: { ...newGame(T0, defs, 3).inventory, food_pancake: 2 }, satiety: 20 };
  const fed = applyAction(g, { type: 'feed', item: 'food_pancake' }, defs, T0);
  assert.ok(fed.ok);
  g = fed.game;
  assert.equal(g.dayLog.counts.fed, 1);
  assert.equal(gameView(g, defs, T0).diary.today, 1);
  const r = applyAction(g, { type: 'sleep' }, defs, T0 + 6 * 3_600_000);
  assert.ok(r.ok && r.event.type === 'slept');
  const id = r.event.diary!;
  const e = r.game.diary.at(-1)!;
  assert.equal(e.id, id);
  assert.equal(e.source, 'template');
  assert.equal(e.read, false);
  assert.ok(e.facts.some((f) => /鬆餅/.test(f)));
  assert.ok(charLen(e.text) <= D.maxChars);
  assert.match(e.date, /季第\d+天/);
  assert.ok(!e.text.includes(e.date), '日記本上有日期，內文不用再寫');
  assert.deepEqual(r.game.dayLog.counts, {}, '紀錄歸零');
  const v = gameView(r.game, defs, T0 + 7 * 3_600_000);
  assert.equal(v.diary.unread, id);
  assert.equal(v.diary.entries[0]!.id, id, '新的在前面');
  const read = applyAction(r.game, { type: 'diary_read', id }, defs, T0 + 7 * 3_600_000);
  assert.ok(read.ok);
  assert.equal(gameView(read.game, defs, T0).diary.unread, null);
  const bad = applyAction(r.game, { type: 'diary_read', id: 'nope' }, defs, T0);
  assert.ok(!bad.ok);
  // 存檔來回一次：一樣
  const back = normalizeGame(JSON.parse(JSON.stringify(read.game)), T0, defs);
  assert.deepEqual(back.diary, read.game.diary);
  // 最多留 keep 篇
  let many = read.game;
  for (let i = 0; i < D.keep + 5; i++) {
    const s = applyAction(many, { type: 'sleep' }, defs, T0 + (i + 1) * 86_400_000);
    assert.ok(s.ok);
    many = s.game;
  }
  assert.equal(many.diary.length, D.keep);
});

test('host 請 AI 寫：正在寫（太久就當沒寫成）→ 寫好換上去；失敗留拼的那篇', () => {
  const base = applyAction(newGame(T0, defs, 5), { type: 'sleep' }, defs, T0);
  assert.ok(base.ok && base.event.type === 'slept');
  const id = base.event.diary!;
  const pending = markDiaryPending(base.game.diary, id, 1000);
  assert.equal(pending.at(-1)!.pending, true);
  // 存檔讀回來：2 分鐘內還在寫；超過就不算
  assert.equal(normalizeDiary(JSON.parse(JSON.stringify(pending)), 60, 1000 + 5000).at(-1)!.pending, true);
  assert.equal(normalizeDiary(JSON.parse(JSON.stringify(pending)), 60, 1000 + DIARY_PENDING_MS + 1).at(-1)!.pending, undefined);
  // 瀏覽器送來的存檔不能自己寫 AI 日記：規則層沒有這種動作
  const done = setDiaryText(pending, id, '今天主人陪我釣魚，好開心～');
  assert.deepEqual({ text: done.at(-1)!.text, source: done.at(-1)!.source, pending: done.at(-1)!.pending }, { text: '今天主人陪我釣魚，好開心～', source: 'ai', pending: undefined });
  const failed = setDiaryText(pending, id, null);
  assert.equal(failed.at(-1)!.source, 'template');
  assert.equal(failed.at(-1)!.pending, undefined);
  assert.equal(failed.at(-1)!.text, base.game.diary.at(-1)!.text);
});

const cfg = (over: Partial<ResolvedAiConfig> = {}): ResolvedAiConfig => ({
  enabled: true, apiKey: 'test-key-123456789', baseUrl: 'https://api.example.com', model: 'deepseek-chat', timeoutMs: 300, keySource: 'env', ...over,
});

test('AI 日記：只送日期、天氣、今天的事；回覆整理成 50 字以內；沒 Key、失敗都回 ok: false', async () => {
  const entry = { date: '冬季第2天', weather: { id: 'rainy', name: '雨天', emoji: '🌧️' }, facts: ['釣到3條魚，有鱸魚', '種了2顆胡蘿蔔'] };
  const msgs = buildDiaryMessages(aiFile, diaryPrompt(entry))!;
  assert.equal(msgs[0]!.role, 'system');
  assert.match(msgs[0]!.content, /鯨魚娘/);
  assert.match(msgs[0]!.content, /50 個字以內/);
  assert.match(msgs[1]!.content, /冬季第2天/);
  assert.match(msgs[1]!.content, /雨天/);
  assert.match(msgs[1]!.content, /釣到3條魚/);

  const calls: { url: string; body: { messages: { content: string }[]; max_tokens: number }; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify({ choices: [{ message: { content: '「鯨魚娘：今天下雨，主人陪我釣到三條魚，還一起種了胡蘿蔔。雨滴答滴答的，好像在幫我們加油～明天也要一起喔！噗嚕～」' } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const ai = new WhaleAi(cfg(), aiFile, { fetch: f });
  const r = await ai.diary(entry, ['你和主人的關係：好朋友']);
  assert.ok(r.ok);
  assert.ok(charLen(r.text) <= aiFile.diary!.maxChars, r.text);
  assert.doesNotMatch(r.text, /^鯨魚娘|「/);
  assert.equal(calls.length, 1);
  const sent = JSON.stringify(calls[0]!.body);
  assert.doesNotMatch(sent, /test-key/, 'Key 不會出現在送出的內容裡（只在 Authorization 標頭）');
  assert.match(sent, /好朋友/);
  assert.equal(calls[0]!.body.max_tokens, aiFile.diary!.maxTokens);

  assert.deepEqual(await new WhaleAi(cfg({ apiKey: '', keySource: 'none' }), aiFile, { fetch: f }).diary(entry), { ok: false, reason: 'no_key' });
  const boom = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
  const logs: string[] = [];
  const fail = await new WhaleAi(cfg(), aiFile, { fetch: boom, log: (m) => logs.push(m) }).diary(entry);
  assert.deepEqual(fail, { ok: false, reason: 'http' });
  assert.ok(logs.some((l) => /日記/.test(l)) && !logs.some((l) => /test-key/.test(l)));
  // 沒有 Key 但 DSH 有 llm 服務：走 llm
  const llmCalls: unknown[] = [];
  const viaLlm = await new WhaleAi(cfg({ apiKey: '', keySource: 'none' }), aiFile, {
    llm: async (req) => {
      llmCalls.push(req);
      return { ok: true, text: '今天好開心～' };
    },
  }).diary(entry);
  assert.deepEqual(viaLlm, { ok: true, text: '今天好開心～', source: 'ai' });
  assert.equal(llmCalls.length, 1);
});
