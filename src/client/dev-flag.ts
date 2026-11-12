// V0.21：開發者模式。網址加 ?dev（例如 鯨魚谷物語.html?dev）才會：
//   - 顯示「快轉 3 小時／跳到明天／離開 3 小時再回來」這些測試按鈕
//   - 在瀏覽器主控台印出 AI 沒回話的原因
// 一般玩家看不到、也不會在主控台留下雜訊。
export function isDevMode(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').has('dev');
  } catch {
    return false;
  }
}

/** 只有開發者模式才印的 log */
export function devLog(...args: unknown[]): void {
  if (isDevMode()) console.info(...args);
}
