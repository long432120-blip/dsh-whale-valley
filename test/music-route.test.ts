// V0.22：DSH 版的背景音樂通道（src/host/music-route.ts）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { musicWhitelist, parseRange, serveMusic } from '../src/host/music-route.ts';
import music from '../packs/whale-girl-pixel/music.json' with { type: 'json' };

test('白名單只收 music.json 裡的檔名', () => {
  const ok = musicWhitelist(music);
  assert.ok(ok.has('farm-day.mp3'));
  assert.equal(ok.size, Object.keys(music.tracks).length);
  const bad = musicWhitelist({ tracks: { a: { src: 'music/../../secret.mp3' }, b: { src: 'music/.hidden.mp3' }, c: { src: 'x.exe' }, d: {} } });
  assert.deepEqual([...bad], ['secret.mp3'], '只取檔名本身，路徑會被丟掉');
});

test('Range 解析', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=50-500', 100), { start: 50, end: 99 });
  assert.equal(parseRange('bytes=200-300', 100), 'bad');
  assert.equal(parseRange('bytes=9-1', 100), 'bad');
  assert.equal(parseRange('items=0-1', 100), null);
});

test('GET 給檔案、Range 給片段、不在白名單或路徑攻擊都 404、POST 405', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'whale-music-'));
  const data = Buffer.from('0123456789abcdefghij');
  await writeFile(join(dir, 'farm-day.mp3'), data);
  await writeFile(join(dir, 'secret.txt'), 'nope');
  const allowed = musicWhitelist(music);
  const server = createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url!, 'http://x').pathname.slice(1));
    void serveMusic(req, res, dir, allowed, name);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  try {
    const full = await fetch(base + 'farm-day.mp3');
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'audio/mpeg');
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(Buffer.from(await full.arrayBuffer()).toString(), data.toString());

    const part = await fetch(base + 'farm-day.mp3', { headers: { range: 'bytes=5-9' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 5-9/20');
    assert.equal(await part.text(), '56789');

    assert.equal((await fetch(base + 'farm-day.mp3', { headers: { range: 'bytes=99-' } })).status, 416);
    assert.equal((await fetch(base + 'farm-day.mp3', { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(base + 'farm-day.mp3', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + 'secret.txt')).status, 404, '不在白名單');
    assert.equal((await fetch(base + '..%2Fsecret.txt')).status, 404, '路徑攻擊');
    assert.equal((await fetch(base + 'rain.mp3')).status, 404, '白名單有、但檔案不存在');
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
