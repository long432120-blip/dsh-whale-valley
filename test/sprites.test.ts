// V0.10：GPT 素材表切出來的圖（sprites.json）：有圖用圖、沒有用 emoji
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { packGameplay } from './pack-gameplay.ts';
import { buildDefs } from '../src/shared/gameplay.ts';
import { animalFrame, cropFrame, itemFrame, monsterFrame, objectFrame, validateSprites, type SpritesFile } from '../src/shared/sprites.ts';

const root = join(import.meta.dirname, '..', 'packs', 'whale-girl-pixel');
const file = JSON.parse(await readFile(join(root, 'sprites.json'), 'utf8')) as SpritesFile;
const gameplay = await packGameplay();
const defs = buildDefs(gameplay);

test('角色包的 sprites.json：每張圖都在圖集裡、對到的物品／作物／動物都存在、作物階段數一致', () => {
  const probs = validateSprites(file, {
    items: [...defs.items.keys()],
    crops: Object.fromEntries(gameplay.crops.map((c) => [c.id, c.stages.length])),
    animals: Object.keys(gameplay.animals ?? {}),
    monsters: (gameplay.mine?.zones ?? []).flatMap((z) => z.monsters.map((m) => m.name)),
  });
  assert.deepEqual(probs, []);
});

test('圖檔都在；高解析圖塊是 4 倍', async () => {
  for (const p of [file.tilesHd!.image, file.atlas!]) assert.ok((await stat(join(root, p))).size > 0, p);
  assert.equal(file.tilesHd!.scale, 4);
});

test('物品：有圖回傳座標，沒圖回 null（畫面改用 emoji）', () => {
  assert.ok(itemFrame(file, 'crop_carrot'));
  assert.ok(itemFrame(file, 'egg'));
  assert.ok(itemFrame(file, 'fish_puffer')); // V0.12：魚的素材表
  assert.ok(itemFrame(file, 'furn_sofa')); // V0.12：家具
  assert.ok(itemFrame(file, 'sword_crystal')); // V0.12：裝備
  assert.ok(itemFrame(file, 'fish_lobster') && itemFrame(file, 'coin')); // V0.13 補畫的
  assert.equal(itemFrame(file, 'no_such_item'), null);
  assert.equal(itemFrame(undefined, 'crop_carrot'), null); // 沒有 sprites.json
});

test('動物：成年、幼崽各一張；沒有幼崽圖時用成年', () => {
  const adult = animalFrame(file, 'cow', false);
  const baby = animalFrame(file, 'cow', true);
  assert.ok(adult && baby && adult !== baby);
  const only: SpritesFile = { ...file, animals: { cow: { adult: 'animal:cow' } } };
  assert.equal(animalFrame(only, 'cow', true), animalFrame(only, 'cow', false));
  assert.equal(animalFrame(file, 'dragon', false), null);
});

test('作物：剛播種不畫（null）、有圖畫圖、標 emoji 的階段和沒設定的作物用 emoji（undefined）', () => {
  assert.equal(cropFrame(file, 'carrot', 0), null);
  assert.ok(cropFrame(file, 'carrot', 1));
  assert.ok(cropFrame(file, 'carrot', 2));
  assert.ok(cropFrame(file, 'pepper', 3)); // V0.13：辣椒成熟有圖了
  assert.ok(cropFrame(file, 'pepper', 1));
  assert.equal(cropFrame(file, 'melon', 1), undefined);
  assert.ok(cropFrame(file, 'carrot', 99)); // 超過階段數：用最後一張
});

test('V0.12：礦洞怪物、石頭、梯子有圖；沒圖的怪物回 null（畫 emoji）', () => {
  for (const name of ['史萊姆', '藍史萊姆', '火焰史萊姆', '蝙蝠', '石頭人', '蘑菇怪', '骷髏', '幽靈', '小惡魔']) assert.ok(monsterFrame(file, name), name);
  assert.equal(monsterFrame(file, '巨龍'), null);
  for (const m of ['preserves', 'smoker', 'artisan', 'furnace']) assert.ok(objectFrame(file, `machine_${m}`), m);
  assert.ok(objectFrame(file, 'mine_rock'));
  assert.ok(objectFrame(file, 'mine_ladder'));
  assert.equal(objectFrame(undefined, 'mine_rock'), null);
  assert.ok(cropFrame(file, 'corn', 4) && cropFrame(file, 'sunflower', 3));
});

test('檢查會抓到常見錯誤', () => {
  const bad = {
    version: 1,
    frames: { a: { x: 0, y: 0, w: 10, h: 10 }, broken: { x: 0, y: 0, w: 0, h: 5 } },
    items: { crop_carrot: 'missing', not_an_item: 'a' },
    animals: { cow: { adult: 'nope' } },
    crops: { carrot: [null, 'a'] },
    monsters: { 史萊姆: 'a', 龍: 'gone' },
  };
  const errs = validateSprites(bad, { items: ['crop_carrot'], crops: { carrot: 3 }, animals: ['cow'], monsters: ['史萊姆'] }).join('\n');
  for (const s of ['圖集裡沒有 missing', '沒有這個物品', '圖集裡沒有 nope', '階段數 2', 'frames.broken', '圖集裡沒有 gone', '礦洞裡沒有這種怪物']) assert.ok(errs.includes(s), `應該抓到「${s}」`);
  assert.deepEqual(validateSprites(null), ['sprites.json：要有 version: 1 和 frames']);
});
