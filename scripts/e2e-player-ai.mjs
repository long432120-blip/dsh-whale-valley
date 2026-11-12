// V0.20 e2e：🔑 設定（填 Key、存、測試、清除）、點她 → 思考中 → AI 台詞；超時／401／沒 Key → 內建台詞
// DeepSeek 用 page.route 假裝（不會真的連網，也不需要真的 Key）
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const FAKE_KEY = 'sk-' + 'a1'.repeat(16);
let mode = 'ok';
const seen = [];
await page.route('https://api.deepseek.com/**', async (route) => {
  const req = route.request();
  const body = JSON.parse(req.postData() || '{}');
  seen.push({ auth: req.headers().authorization, model: body.model, max_tokens: body.max_tokens, system: body.messages?.[0]?.content ?? '', n: body.messages?.length });
  if (mode === 'hang') return; // 永遠不回：10 秒後瀏覽器端自己放棄
  if (mode === '401') return route.fulfill({ status: 401, body: '{"error":"bad key"}', headers: { 'access-control-allow-origin': '*' } });
  await new Promise((r) => setTimeout(r, 900));
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ choices: [{ message: { content: body.max_tokens === 5 ? '好' : '主人～外面下雨了耶，我們一起待在家好不好？' } }] }) });
});
await page.clock.install({ time: new Date(2026, 8, 24, 14, 0) });
await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('whale-pet:minigame', 'off'); localStorage.setItem('whale-pet:late-night', JSON.stringify({ last: Date.now() + 9e9 })); });
await page.reload(); await page.waitForSelector('.px-canvas'); await page.clock.runFor(1500);
const KEY = 'dsh-whale-pet:pixel-standalone';
await page.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); s.game.quest = { chain: null, step: 0, progress: 0, done: { tutorial: true, 'town-life': true }, nagAt: 0, last: null }; s.sceneId = 'room'; localStorage.setItem(k, JSON.stringify(s)); }, KEY);
await page.reload(); await page.waitForSelector('.px-canvas'); await page.clock.runFor(2000);
const st = () => page.evaluate(() => {
  const s = document.querySelector('.px-stage'); const d = document.querySelector('.px-dialog');
  return { thinking: s.dataset.thinking ?? null, aiKey: s.dataset.aiKey ?? null,
    dialog: d.classList.contains('show') ? document.querySelector('.px-dialog-text').textContent : null,
    think: document.querySelector('.px-think')?.hidden === false ? document.querySelector('.px-think').textContent : null,
    status: document.querySelector('.px-ai-status')?.textContent ?? null, now: document.querySelector('.px-ai-now')?.textContent ?? null,
    title: document.title, h1: document.querySelector('.game-title')?.textContent ?? null };
});
const closeDialog = async () => { for (let i = 0; i < 8; i++) { if (!(await st()).dialog) return; await page.locator('.px-dialog').click().catch(() => {}); await page.clock.runFor(300); } };
const tapPet = async () => {
  const d = await page.evaluate(() => document.querySelector('.px-stage').__pxDebug().petPx);
  const box = await page.locator('.px-canvas').boundingBox();
  await page.mouse.click(box.x + ((d.x + d.ox) / d.vw) * box.width, box.y + ((d.y + d.oy - 14) / d.vh) * box.height);
};
await closeDialog();
console.log('0 title', JSON.stringify((await st()).title), (await st()).h1);
// 1. 沒有 Key：點她 → 內建台詞，沒有發請求
await tapPet(); await page.clock.runFor(600);
let s = await st(); console.log('1 no key → line:', s.dialog, '| requests', seen.length);
await page.clock.runFor(1500); await closeDialog(); await page.clock.runFor(3500);
// 2. 打開 🔑 設定（按鈕在側邊欄）
await page.locator('.px-bag-btn', { hasText: '🔑' }).click(); await page.clock.runFor(300);
s = await st(); console.log('2 panel', s.now, '| aiKey', s.aiKey);
await page.screenshot({ path: `${out}-2-panel.png` });
// 3. 輸入 Key：輸入框打字不會觸發快捷鍵（b 不會開揹包）
await page.locator('.px-ai-input').fill(FAKE_KEY);
await page.locator('.px-ai-input').press('b');
await page.locator('.px-ai-input').fill(FAKE_KEY);
await page.getByRole('button', { name: '🧪 測試連線' }).click();
for (let i = 0; i < 20 && !/成功|❌/.test((await st()).status ?? ''); i++) await page.clock.runFor(200);
console.log('3 test', (await st()).status, '| test request max_tokens', seen.at(-1)?.max_tokens);
await page.locator('.px-ai-input').fill(FAKE_KEY); await page.getByRole('button', { name: '💾 儲存' }).click(); await page.clock.runFor(200);
s = await st(); console.log('3 saved', s.now, '|', s.status, '| stored', await page.evaluate(() => localStorage.getItem('whale-pet:deepseek-api-key')?.slice(0, 5)));
await page.screenshot({ path: `${out}-3-saved.png` });
await page.locator('.px-ai-settings').getByRole('button', { name: '✕ 關閉' }).click(); await page.clock.runFor(1200);
// 4. 點她 → 思考中 → AI 台詞
const n0 = seen.length;
await tapPet(); await page.clock.runFor(500);
s = await st(); console.log('4 thinking', s.thinking, JSON.stringify(s.think));
await page.waitForTimeout(400); await page.screenshot({ path: `${out}-4-thinking.png` });
for (let i = 0; i < 30 && !(await st()).dialog; i++) await page.clock.runFor(100);
await page.clock.runFor(2500);
s = await st(); console.log('4 ai line', s.dialog, '| req', seen.length - n0, JSON.stringify({ auth: seen.at(-1)?.auth?.slice(0, 12), model: seen.at(-1)?.model, max_tokens: seen.at(-1)?.max_tokens }));
console.log('4 system has state', ['體力', '飽食度', '好感', '天氣', '室內房間'].map((w) => `${w}:${seen.at(-1)?.system.includes(w)}`).join(' '));
await page.screenshot({ path: `${out}-4-line.png` });
await closeDialog();
// 5. 3 秒內連點：只送第一次
await page.clock.runFor(4000);
const n1 = seen.length;
await tapPet(); await page.clock.runFor(450); await closeDialog(); await tapPet(); await page.clock.runFor(450); await closeDialog(); await tapPet(); await page.clock.runFor(450);
await page.clock.runFor(1500); await closeDialog();
console.log('5 rapid taps → requests', seen.length - n1);
// 6. 超時（永遠不回）：10 秒後改用內建台詞，不會一直思考中
await page.clock.runFor(4000); await closeDialog();
mode = 'hang';
await tapPet(); await page.clock.runFor(500);
console.log('6 thinking', (await st()).thinking);
await page.clock.runFor(10_500);
for (let i = 0; i < 20 && !(await st()).dialog; i++) await page.clock.runFor(200);
s = await st(); console.log('6 after timeout', s.thinking, '| line:', s.dialog);
await closeDialog();
// 7. 401：內建台詞
await page.clock.runFor(4000); await closeDialog();
mode = '401';
await tapPet(); await page.clock.runFor(800);
for (let i = 0; i < 20 && !(await st()).dialog; i++) await page.clock.runFor(200);
s = await st(); console.log('7 401 → line:', s.dialog, '| thinking', s.thinking);
await closeDialog();
// 8. 清除 Key
await page.keyboard.press('Escape');
await page.locator('.px-canvas').focus(); await page.keyboard.press('i'); await page.clock.runFor(300);
await page.getByRole('button', { name: '🗑 清除 Key' }).click(); await page.clock.runFor(200);
s = await st(); console.log('8 cleared', s.now, '|', s.status, '| stored', await page.evaluate(() => [localStorage.getItem('whale-pet:deepseek-api-key'), localStorage.getItem('whale-pet:ai-memory')]));
console.log('logs', JSON.stringify(logs));
await browser.close();
