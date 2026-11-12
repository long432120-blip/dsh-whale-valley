/**
 * 把任意 URL 安全地放進 CSS 的 url("…")。
 * 打包器產生的 SVG data URL 會含有未跳脫的雙引號，直接拼字串會把 url("…") 提早截斷、圖片整個消失。
 */
export function cssUrl(u: string): string {
  return `url("${u.replace(/["\\\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}")`;
}
