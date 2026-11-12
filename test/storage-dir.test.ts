// V0.20：改名後的存檔資料夾（舊資料夾要沿用）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { defaultStorageDir } from '../src/host/storage-dir.ts';

const home = '/home/u';
const base = join(home, '.dsh', 'storages');

test('新安裝：用新名字 dsh-whale-valley', () => {
  assert.equal(defaultStorageDir(home, () => false), join(base, 'dsh-whale-valley'));
});
test('只有舊資料夾：繼續用舊的，存檔不會不見', () => {
  assert.equal(defaultStorageDir(home, (p) => p === join(base, 'dsh-whale-pet')), join(base, 'dsh-whale-pet'));
});
test('兩個都有：用新的', () => {
  assert.equal(defaultStorageDir(home, () => true), join(base, 'dsh-whale-valley'));
});
