// 讓 TypeScript 認得打包器轉成 data URL 的圖片 import
declare module '*.svg' {
  const url: string;
  export default url;
}
declare module '*.webp' {
  const url: string;
  export default url;
}
declare module '*.png' {
  const url: string;
  export default url;
}
// Tiled 的地圖與圖塊集是 JSON，打包時用 json loader 內嵌
declare module '*.tmj' {
  const data: unknown;
  export default data;
}
declare module '*.tsj' {
  const data: unknown;
  export default data;
}
