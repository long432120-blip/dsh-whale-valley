import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { JsonStore } from '../src/host/store.ts';

type Counter = { n: number };

test('同時 20 個寫入會排隊，不會互相蓋掉', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'whale-pet-'));
  const store = new JsonStore<Counter>(dir);
  await Promise.all(
    Array.from({ length: 20 }, () =>
      store.update((raw) => {
        const n = ((raw as Counter | undefined)?.n ?? 0) + 1;
        return { next: { n }, result: n };
      }),
    ),
  );
  assert.deepEqual(JSON.parse(await readFile(store.path, 'utf8')), { n: 20 });
  assert.deepEqual(await readdir(dir), ['save.json']); // 沒有殘留暫存檔
});

test('存檔壞掉時改名備份，然後當作新存檔', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'whale-pet-'));
  const store = new JsonStore<Counter>(dir);
  await writeFile(store.path, '{ broken');
  assert.equal(await store.read(), undefined);
  assert.ok((await readdir(dir)).some((f) => f.startsWith('save.json.corrupt-')));
});
