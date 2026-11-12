// V0.16：時間與天氣木牌（scenes.json 的 hud.clock）
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { PACK_DIR } from './pack-gameplay.ts';
import { clockFace, validateClockHud, type ClockHudDef } from '../src/shared/clock-hud.ts';
import type { PixelWorldFile } from '../src/shared/pixel-types.ts';

const world = JSON.parse(await readFile(join(PACK_DIR, 'scenes.json'), 'utf8')) as PixelWorldFile;
const def = world.hud!.clock!;
const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m).getTime();
const autumn = { id: 'autumn', name: '秋', emoji: '🍂', day: 12, days: 28 };
const winter = { id: 'winter', name: '冬', emoji: '❄️', day: 1, days: 7 };
const sunny = { id: 'sunny', name: '晴天', emoji: '☀️' };

test('角色包的木牌設定通過檢查，圖檔都在', async () => {
  assert.deepEqual(validateClockHud(def), []);
  for (const p of [def.board, def.icons.src]) assert.ok((await stat(join(PACK_DIR, p))).size > 0, p);
  // 遊戲裡的每種天氣都有像素圖示
  const weather = JSON.parse(await readFile(join(PACK_DIR, 'weather.json'), 'utf8')) as { types: { id: string }[] };
  for (const w of weather.types) assert.ok(def.icons.names.includes(w.id), `天氣 ${w.id} 沒有圖示`);
});

test('季節、天數、時段、時間、天氣', () => {
  const f = clockFace(def, { now: at(14, 5), season: autumn, weather: sunny });
  assert.equal(f.season, '秋季 第 12 天');
  assert.equal(f.seasonEmoji, '🍂');
  assert.equal(f.seasonIcon, -1, '秋天沒有指定像素圖示，用 emoji');
  assert.equal(f.time, '下午 14:05');
  assert.equal(f.phaseIcon, '🕒');
  assert.equal(f.weatherName, '晴天');
  assert.equal(f.weatherIcon, def.icons.names.indexOf('sunny'));
  assert.equal(f.night, false);
  // 冬天用像素雪花
  assert.equal(clockFace(def, { now: at(9), season: winter, weather: sunny }).seasonIcon, def.icons.names.indexOf('snowy'));
  // 名字已經有「季」就不重複
  assert.equal(clockFace(def, { now: at(9), season: { ...autumn, name: '秋季' }, weather: sunny }).season, '秋季 第 12 天');
  // 沒有圖示的天氣用 emoji
  assert.equal(clockFace(def, { now: at(9), season: null, weather: { id: 'fog', name: '霧', emoji: '🌫️' } }).weatherIcon, -1);
});

test('晚上（18 點以後、6 點以前）木牌變暗；時段名稱跟著變', () => {
  const f = (h: number, m = 0) => clockFace(def, { now: at(h, m), season: autumn, weather: sunny });
  assert.equal(f(17, 59).night, false);
  assert.equal(f(18).night, true);
  assert.equal(f(23, 30).night, true);
  assert.equal(f(3).night, true);
  assert.equal(f(6).night, false);
  assert.equal(f(7).phaseName, '早上');
  assert.equal(f(18).phaseName, '傍晚');
  assert.equal(f(21).time, '夜晚 21:00');
  assert.equal(f(21).phaseIcon, '🌙');
  // 不跨午夜的設定也可以
  const odd: ClockHudDef = { ...def, nightFrom: 1, nightTo: 4 };
  assert.equal(clockFace(odd, { now: at(2), season: null, weather: sunny }).night, true);
  assert.equal(clockFace(odd, { now: at(5), season: null, weather: sunny }).night, false);
});

test('設定寫錯會被抓到', () => {
  const errs = validateClockHud({ board: '', icons: { src: 'x.png', size: 0, names: [] }, corner: 'middle', nightFrom: 25, seasonIcons: { winter: 'moon' } }).join('\n');
  for (const k of ['board', 'icons', 'corner', 'nightFrom', 'moon']) assert.match(errs, new RegExp(k));
});
