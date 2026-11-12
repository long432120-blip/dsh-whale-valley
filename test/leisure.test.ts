// V0.11：廚房、浴室、遊戲室（leisure.json）：泡澡、玩遊戲、水龍頭；走廊的門可以選目的地
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { packGameplay, PACK_DIR } from './pack-gameplay.ts';
import { applyAction, buildDefs, gameView, newGame, normalizeGame, validateGameplay } from '../src/shared/gameplay.ts';
import type { GameAction, GameplayFile, GameState } from '../src/shared/gameplay-types.ts';
import { buildBackgroundMap, validateInteractables, type InteractablesFile } from '../src/shared/hotspots.ts';
import { distances } from '../src/shared/path.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = new Date(2026, 10, 10, 14, 0).getTime();
const file: GameplayFile = await packGameplay();
const defs = buildDefs(file);
const L = file.leisure!;

const run = (g: GameState, a: GameAction, at = T0) => applyAction(g, a, defs, at);
const must = (g: GameState, a: GameAction, at = T0) => {
  const r = run(g, a, at);
  assert.ok(r.ok, `${a.type} 失敗：${!r.ok ? r.error : ''}`);
  return r;
};
const fresh = (over: Partial<GameState> = {}): GameState => ({ ...newGame(T0, defs, 7), ...over });

test('leisure.json 載入且通過檢查；廚房水龍頭是喝水的水源', () => {
  assert.deepEqual(validateGameplay(file), []);
  assert.ok(L.play.games.console && L.play.games.arcade);
  assert.ok(file.stats!.satiety.drink.taps?.includes('tap'));
  const g = fresh({ satiety: 20 });
  const r = must(g, { type: 'drink', table: 'tap' });
  assert.equal(r.event.type, 'drank');
  assert.ok(gameView(g, defs, T0).stats.drinkTables.includes('tap'));
});

test('泡澡：體力 +bath.stamina（不超過上限）、好感算在每日上限、冷卻時間內不能再泡', () => {
  let g = fresh({ stamina: 20 });
  const r = must(g, { type: 'bath' });
  assert.ok(r.event.type === 'bathed');
  assert.equal(r.game.stamina, 20 + L.bath.stamina);
  assert.equal(r.game.affection, L.bath.affection);
  g = r.game;
  const again = run(g, { type: 'bath' }, T0 + HOUR);
  assert.ok(!again.ok && again.error === 'cooldown');
  assert.equal(gameView(g, defs, T0).stats.bathReadyAt, T0 + L.bath.cooldownHours * HOUR);
  // 冷卻過了可以再泡；體力不超過上限
  const later = must({ ...g, stamina: 95 }, { type: 'bath' }, T0 + L.bath.cooldownHours * HOUR);
  assert.equal(later.game.stamina, 100);
  // 今天的好感已經滿了：泡澡照樣回體力，但不加好感
  const capped = must(fresh({ stamina: 10, affectionToday: { day: '2026-11-10', gained: 9999 } }), { type: 'bath' });
  assert.ok(capped.event.type === 'bathed' && capped.event.gain === 0);
});

test('玩遊戲：開始 → 玩了幾小時 → 結算好感、體力、關卡；最多算 maxHours', () => {
  let g = fresh({ stamina: 30 });
  const s = must(g, { type: 'play', game: 'console' });
  assert.deepEqual(s.game.play, { game: 'console', since: T0 });
  assert.equal(gameView(s.game, defs, T0).stats.play?.name, L.play.games.console!.name);
  // 已經在玩：再按一次不會重新開始
  const dup = must(s.game, { type: 'play', game: 'arcade' }, T0 + HOUR);
  assert.deepEqual(dup.game.play, { game: 'console', since: T0 });
  g = s.game;
  const end = must(g, { type: 'stop_play' }, T0 + 2 * HOUR);
  assert.ok(end.event.type === 'play_stopped');
  assert.equal(end.event.minutes, 120);
  assert.equal(end.event.gain, Math.min(2 * L.play.affectionPerHour, L.play.maxAffectionPerSession));
  assert.equal(end.game.stamina, 30 + 2 * L.play.staminaPerHour);
  assert.equal(end.event.level, 1 + 2 * L.play.levelsPerHour);
  assert.equal(end.game.play, null);
  // 掛機一整晚：只算 maxHours，好感不超過一次的上限
  const long = must(s.game, { type: 'stop_play' }, T0 + 30 * HOUR);
  assert.ok(long.event.type === 'play_stopped');
  assert.equal(long.event.minutes, L.play.maxHours * 60);
  assert.ok(long.event.gain <= L.play.maxAffectionPerSession);
});

test('玩遊戲：沒在玩不能結算；不認得的遊戲不行；睡覺會停止；存檔讀回來還在玩', () => {
  const g = fresh();
  const r = run(g, { type: 'stop_play' });
  assert.ok(!r.ok && r.error === 'not_playing');
  const bad = run(g, { type: 'play', game: 'pinball' });
  assert.ok(!bad.ok && bad.error === 'unknown');
  const playing = must(g, { type: 'play', game: 'arcade' }).game;
  const slept = must(playing, { type: 'sleep' }, T0 + HOUR);
  assert.equal(slept.game.play, null);
  const back = normalizeGame(JSON.parse(JSON.stringify(playing)), T0, defs);
  assert.deepEqual(back.play, { game: 'arcade', since: T0 });
  // 存檔裡是不認得的遊戲（例如 mod 拿掉了）：當成沒在玩
  const gone = normalizeGame({ ...JSON.parse(JSON.stringify(playing)), play: { game: 'pinball', since: T0 } }, T0, defs);
  assert.equal(gone.play, null);
});

test('三個新房間：熱區都走得到；門口可以選目的地（每個目的地一扇門，尋路才找得到）', async () => {
  const hs = JSON.parse(await readFile(join(PACK_DIR, 'interactables.json'), 'utf8')) as InteractablesFile;
  const world = JSON.parse(await readFile(join(PACK_DIR, 'scenes.json'), 'utf8')) as { scenes: { id: string }[] };
  assert.deepEqual(validateInteractables(hs, {
    scenes: world.scenes.map((s) => s.id),
    shops: Object.keys(file.shops),
    unlocks: Object.keys(file.unlocks ?? {}),
    games: Object.keys(L.play.games),
    taps: [...file.stats!.satiety.drink.tables, ...(file.stats!.satiety.drink.taps ?? [])],
  }), []);
  for (const id of ['kitchen', 'bath', 'gameroom']) {
    const m = buildBackgroundMap(hs.scenes[id]!, 16);
    const dist = distances(m, m.spawns.default!.tile);
    const reach = (t: { x: number; y: number }) => Number.isFinite(dist[t.y * m.width + t.x]!);
    for (const it of m.interactables) if (it.hotspot?.approach !== 'none') assert.ok(it.stands.every(reach), `${id}/${it.id} 走不到`);
    assert.deepEqual(new Set(m.doors.map((d) => d.to)).size, m.doors.length, `${id} 的門目的地重複`);
    assert.ok(m.doors.some((d) => d.to === 'room'), `${id} 回不到房間`);
    assert.ok(m.doors.every((d) => d.stand && reach(d.stand)));
  }
  const room = buildBackgroundMap(hs.scenes.room!, 16);
  assert.deepEqual(room.doors.filter((d) => d.id === 'door' || d.id.startsWith('door#')).map((d) => d.to), ['garden', 'kitchen', 'bath', 'gameroom']);
  // 遊戲室有可以玩的東西；浴室有溫泉；廚房有水龍頭和爐子
  const types = (id: string) => hs.scenes[id]!.hotspots.map((h) => h.action.type);
  assert.ok(types('gameroom').includes('play'));
  assert.ok(types('bath').includes('bath'));
  assert.ok(types('kitchen').includes('drink') && types('kitchen').includes('shop'));
});
