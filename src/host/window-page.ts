// V0.23 模式 B：DSH 的「🪟 開新視窗玩」打開的遊戲頁。
//
//   GET /api/dsh-whale-valley/play            這一頁（HTML）
//   GET /api/dsh-whale-valley/play/boot.js    小小的載入器（模擬 DSH 的 __ModuleLoader__，react 給空殼）
//   GET /api/dsh-whale-valley/play/client.js  跟 DSH 裡同一個 lib/client.js（不用另外打包一份）
//
// 同一個網域，所以 DSH 的登入 cookie 會自動帶上；存檔也是同一份（走 host 的通道）。
// 沒有任何外部資源（字型、CDN 都沒有），斷網也能開。

export const WINDOW_HTML = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>鯨魚谷物語</title>
<link rel="icon" href="data:,">
<style>
  html, body { margin: 0; min-height: 100%; background: radial-gradient(ellipse at 50% 30%, #3a2c4d 0%, #1d1528 70%); }
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 12px; box-sizing: border-box;
         font-family: system-ui, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif; }
  #app { width: min(1320px, 96vw); }
  #boot { color: #fff3d6; text-align: center; font-size: 16px; }
</style>
</head>
<body>
<div id="app"><div id="boot">🐋 鯨魚谷物語 載入中…</div></div>
<script src="./play/boot.js"></script>
<script src="./play/client.js"></script>
</body>
</html>
`;

/** 模擬 DSH 的模組載入器：client.js 載好後呼叫 bootWindowGame（react 只在 DSH 浮層的元件裡用到，這裡給空殼） */
export const BOOT_JS = `(function () {
  var react = { useEffect: function () {}, useRef: function () { return { current: null }; }, createElement: function () { return null; } };
  var jsx = { jsx: function () { return null; }, jsxs: function () { return null; }, Fragment: null };
  window.__ModuleLoader__ = {
    load: function (spec) {
      var app = document.getElementById('app');
      try {
        var mod = spec.factory(function (name) {
          if (name === 'react') return react;
          if (name === 'react/jsx-runtime') return jsx;
          return {};
        });
        app.textContent = '';
        mod.bootWindowGame(app).catch(function (err) { console.error(err); app.textContent = '啟動失敗，請關掉視窗再試一次。'; });
      } catch (err) {
        console.error(err);
        app.textContent = '啟動失敗，請關掉視窗再試一次。';
      }
    }
  };
})();
`;
