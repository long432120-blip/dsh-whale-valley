// 像素版樣式。全部 class 加 px- 前綴，不碰宿主 DOM。
export const PIXEL_CSS = /* css */ `
.px-stage{position:relative;width:100%;background:#120e1c;border-radius:12px;overflow:hidden;overflow:clip;
  display:grid;place-items:center;container-type:inline-size;user-select:none;-webkit-user-select:none;
  font-family:system-ui,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif}
.px-canvas{display:block;image-rendering:pixelated;image-rendering:crisp-edges;touch-action:manipulation;outline:none}
.px-tip{position:absolute;padding:.2em .7em;border-radius:6px;background:#fff3d6;color:#4a2b17;border:2px solid #6b3f22;
  font-size:clamp(11px,1.7cqw,14px);white-space:nowrap;max-width:calc(100% - 8px);overflow:hidden;text-overflow:ellipsis;pointer-events:none;opacity:0;transition:opacity .15s;translate:-50% -120%}
.px-tip.show{opacity:1}
.px-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .28s}
.px-fade.on{opacity:1;pointer-events:auto}

.px-dialog{position:absolute;left:3%;right:3%;bottom:3%;display:flex;align-items:stretch;gap:2.5%;padding:2% 2.5%;
  background:#fff3d6;border:4px solid #6b3f22;border-radius:6px;
  box-shadow:inset 0 0 0 3px #e9c48a,0 4px 0 rgba(0,0,0,.35);
  opacity:0;translate:0 10px;transition:opacity .16s,translate .16s;pointer-events:none}
.px-dialog.top{top:3%;bottom:auto;translate:0 -10px}
.px-dialog.show{opacity:1;translate:0 0;pointer-events:auto;cursor:pointer}
.px-dialog-text{flex:1;position:relative;color:#4a2b17;font-size:clamp(13px,2.6cqw,21px);line-height:1.55;
  min-height:3.2em;align-self:center;white-space:pre-wrap;word-break:break-word}
.px-dialog.done .px-dialog-text::after{content:"▼";position:absolute;right:0;bottom:-.2em;font-size:.7em;color:#b06a3a;
  animation:px-blink .9s steps(2) infinite}
.px-dialog-side{width:13%;max-width:110px;display:flex;flex-direction:column;align-items:center;gap:6px}
.px-portrait{width:100%;background-color:#ffe6bd;background-repeat:no-repeat;border:3px solid #6b3f22;border-radius:4px}
.px-name{font-size:clamp(11px,1.8cqw,15px);background:#e9c48a;color:#4a2b17;padding:.1em .7em;border-radius:4px;
  border:2px solid #6b3f22;white-space:nowrap}
/* ── V0.2 玩法 UI ── */
.px-hud{position:absolute;left:1.5%;top:2%;display:grid;gap:4px;padding:6px 8px;background:rgba(255,243,214,.92);
  border:3px solid #6b3f22;border-radius:6px;font-size:clamp(10px,1.6cqw,13px);color:#4a2b17;pointer-events:none;min-width:24%}
.px-hud-row{display:grid;grid-template-columns:1.4em 1fr auto;align-items:center;gap:6px}
.px-hud-icon{text-align:center}
.px-hud-bar{height:.7em;background:#e9d3b0;border:2px solid #6b3f22;border-radius:3px;overflow:hidden}
.px-hud-fill{height:100%;width:0;transition:width .4s}
.stamina .px-hud-fill{background:#f2c14e}.satiety .px-hud-fill{background:#8fd16f}.affection .px-hud-fill{background:#ff7aa2}
.px-hud-text{font-variant-numeric:tabular-nums;white-space:nowrap}
.px-bag-btn{position:absolute;right:1.5%;top:2%;width:clamp(30px,5.5cqw,46px);aspect-ratio:1;border:3px solid #6b3f22;border-radius:8px;
  background:#fff3d6;font-size:clamp(16px,3cqw,26px);line-height:1;cursor:pointer;box-shadow:0 3px 0 rgba(0,0,0,.35)}
.px-bag-btn:hover{background:#ffe6bd}.px-bag-btn:active{translate:0 2px;box-shadow:0 1px 0 rgba(0,0,0,.35)}
.px-hud-btns{position:absolute;right:1.5%;top:2%;display:flex;gap:6px;flex-direction:row-reverse}
.px-hud-btns .px-bag-btn{position:static}
.px-hud-btns .px-bag-btn.on{background:#8fd16f}
.px-portrait-emoji{font-size:clamp(34px,7cqw,64px);line-height:1.2;text-align:center}
.px-world{position:relative;display:grid;gap:0;width:100%;margin:.2em 0 .5em;padding:0;background:#e8f3d6;
  background-image:radial-gradient(#d5e8bd 1px,transparent 1px);background-size:14px 14px;border:3px solid #c99a6a;border-radius:10px;overflow:hidden}
.px-world-lines{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.px-world-lines line{stroke:#a8794d;stroke-width:5;stroke-linecap:round}
.px-world-lines line.locked{stroke:#bcb0a4;stroke-dasharray:7 7}
.px-world-node{position:relative;z-index:1;align-self:center;justify-self:center;display:grid;justify-items:center;gap:2px;
  width:min(9.5em,88%);margin:.5em 0;padding:.4em .35em;border:3px solid #6b3f22;border-radius:10px;background:#fffaf0;color:#4a2b17;
  font:inherit;cursor:pointer;box-shadow:0 3px 0 rgba(0,0,0,.25);transition:transform .1s,background .1s}
.px-world-node:hover:not(:disabled){background:#fff;transform:translateY(-3px)}
.px-world-node:active:not(:disabled){transform:translateY(1px);box-shadow:inset 0 2px 0 rgba(0,0,0,.25)}
.px-world-node.here{background:#ffe08a;border-color:#c98a10;cursor:default;box-shadow:0 0 0 3px rgba(255,216,107,.55),0 3px 0 rgba(0,0,0,.25)}
.px-world-node.locked{background:#e6ddd0;color:#8a7a6c;border-style:dashed;cursor:not-allowed;box-shadow:none}
.px-world-node.tp:not(:disabled):not(.locked){background:#e4ddff;border-color:#5b45b8}
.px-world-node.tp:hover:not(:disabled){background:#f3efff}
.px-world-modes{justify-content:center}
/* V0.14：家具目錄 */
.px-modal[data-kind=catalog]{width:min(860px,95%)}
.px-catalog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.5em;max-height:52vh;overflow:auto;padding:.1em}
.px-catalog-card{display:grid;grid-template-columns:auto 1fr;gap:.2em .6em;align-items:center;padding:.45em .5em;background:#fffaf0;border:2px solid #d9b98a;border-radius:6px}
.px-catalog-card.new{border-color:#3fbf6a;box-shadow:0 0 0 3px rgba(63,191,106,.3)}
.px-catalog-icon{grid-row:span 2;display:grid;place-items:center;width:48px;height:48px;background:#f3e3c3;border-radius:6px}
.px-catalog-name{font-weight:700}
.px-catalog-meta,.px-catalog-own{font-size:.75em;opacity:.8}
.px-catalog-own{color:#2f7a45;opacity:1;font-weight:700}
.px-catalog-desc{font-size:.75em;opacity:.7}
.px-catalog-btns{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:.3em}
.px-catalog-btns .px-trade-btn{font-size:.8em;padding:.15em .5em}
.px-catalog-btns .sell{background:#f3e3c3}
/* V0.13：酒館的小遊戲 */
.px-arcade-head{display:flex;flex-wrap:wrap;gap:.3em 1em;justify-content:center;font-size:.85em;margin-bottom:.4em}
.px-arcade-stage{display:grid;place-items:center;height:7.5em;margin:.2em 0;background:radial-gradient(circle,#3a2a55 0,#1c1430 70%);border:3px solid #6b3f22;border-radius:6px}
.px-coin{width:3.4em;height:3.4em;border-radius:50%;display:grid;place-items:center;font-size:1.6em;background:radial-gradient(circle at 35% 30%,#fff6b0,#f2b72b 55%,#b9770e);border:3px solid #7a4a06;box-shadow:0 4px 0 rgba(0,0,0,.35)}
.px-coin.spin{animation:px-coin-spin .35s linear infinite}
.px-coin.win{box-shadow:0 0 0 6px rgba(255,226,107,.55),0 4px 0 rgba(0,0,0,.35)}
.px-coin.lose{filter:saturate(.6) brightness(.9)}
@keyframes px-coin-spin{0%{transform:scaleX(1)}50%{transform:scaleX(.08)}100%{transform:scaleX(1)}}
.px-arcade-msg{white-space:pre-line;text-align:center;margin:.5em 0;min-height:2.6em}
.px-arcade-btns{display:flex;flex-wrap:wrap;gap:.5em;justify-content:center}
.px-card-table{display:flex;align-items:center;justify-content:center;gap:1.2em;padding:.8em;background:#2f7a45;border:3px solid #6b3f22;border-radius:8px}
.px-card-slot{display:grid;justify-items:center;gap:.3em}
.px-card-who{font-size:.8em;color:#fff3d6}
.px-card{width:3.6em;height:5em;border-radius:6px;background:#fffaf0;border:2px solid #3b2433;display:grid;place-items:center;align-content:center;color:#2b2233;box-shadow:0 3px 0 rgba(0,0,0,.3)}
.px-card.red{color:#c0302b}
.px-card .rank{font-size:1.5em;font-weight:700;line-height:1}
.px-card .suit{font-size:1.2em;line-height:1}
.px-card.back{background:repeating-linear-gradient(45deg,#5b45b8 0 6px,#7d68d6 6px 12px)}
.px-card-table.dealing .px-card{animation:px-card-deal .5s ease-in-out infinite alternate}
@keyframes px-card-deal{from{transform:translateY(0)}to{transform:translateY(-6px) rotate(-3deg)}}
.px-card-vs{font-weight:700;color:#ffe08a;font-size:1.2em}
.px-world-icon{font-size:1.7em;line-height:1.1}
.px-world-name{font-weight:700;white-space:nowrap}
.px-world-here,.px-world-hint{font-size:.72em;line-height:1.25;text-align:center;white-space:normal}
.px-world-here{color:#9a5b00;font-weight:700}
.px-world-legend{display:flex;flex-wrap:wrap;gap:.4em .9em;font-size:.82em;margin-bottom:.2em}
.px-world-legend span{display:inline-flex;align-items:center;gap:.3em}
.px-world-legend span::before{content:"";width:1em;height:.8em;border-radius:3px;border:2px solid #6b3f22;background:#fffaf0}
.px-world-legend .here::before{background:#ffe08a;border-color:#c98a10}
.px-world-legend .lock::before{background:#e6ddd0;border-style:dashed}
.px-modal[data-kind=worldmap]{width:min(820px,94%)}
.px-bubble{position:absolute;transform:translate(-50%,-100%);max-width:min(46%,280px);padding:.35em .65em;margin-top:-6px;background:#fffdf5;
  border:3px solid #3b2433;border-radius:10px;color:#3b2433;font-size:clamp(11px,1.9cqw,16px);line-height:1.35;box-shadow:0 3px 0 rgba(0,0,0,.25);
  pointer-events:none;animation:px-pop .18s ease-out;z-index:2}
.px-bubble::after{content:"";position:absolute;left:50%;bottom:-9px;margin-left:-7px;border:7px solid transparent;border-top-color:#3b2433;border-bottom:0}
.px-bubble::before{content:"";position:absolute;left:50%;bottom:-5px;margin-left:-4px;border:4px solid transparent;border-top-color:#fffdf5;border-bottom:0;z-index:1}
.px-bubble.px-think{min-width:4.6em;text-align:left;color:#7a5a6a}
.px-think-dots{display:inline-flex;gap:.2em;margin-left:.3em;vertical-align:middle}
.px-think-dots i{display:block;width:.34em;height:.34em;border-radius:1px;background:currentColor;animation:px-think-bounce 1s ease-in-out infinite}
.px-think-dots i:nth-child(2){animation-delay:.15s}
.px-think-dots i:nth-child(3){animation-delay:.3s}
@keyframes px-think-bounce{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-.4em);opacity:1}}
.px-dialog.thinking .px-dialog-text{opacity:.78}
.px-dialog.thinking .px-dialog-text::after{display:none}
@media (prefers-reduced-motion:reduce){.px-think-dots i{animation:none;opacity:.8}}
@keyframes px-pop{from{transform:translate(-50%,-90%) scale(.8);opacity:0}to{transform:translate(-50%,-100%) scale(1);opacity:1}}
.px-quest{position:absolute;left:1.5%;top:calc(2% + clamp(76px,13.5cqw,112px));max-width:46%;padding:.3em .6em;background:rgba(255,248,230,.95);
  border:3px solid #6b3f22;border-radius:6px;color:#4a2b17;font:inherit;font-size:clamp(11px,1.8cqw,15px);text-align:left;cursor:pointer;
  box-shadow:0 3px 0 rgba(0,0,0,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.px-quest:hover{background:#fff}
.px-portrait-img{width:100%;max-height:clamp(60px,12cqw,110px);object-fit:contain;image-rendering:pixelated}
.px-gear-now{font-size:.9em;opacity:.85}
.px-rarity{font-size:.75em;font-weight:700}
.px-slot.rare-epic{box-shadow:inset 0 0 0 2px #9b4fd0}
.px-slot.rare-legendary{box-shadow:inset 0 0 0 2px #d89a10}
.px-codex-card.rare-legendary:not(.unknown){background:#fff6d6}
.px-codex-card.rare-epic:not(.unknown){background:#f6ecff}
.px-goddess{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:2%;background:rgba(20,30,60,.55);cursor:pointer;z-index:5;
  animation:px-fadein .5s ease-out}
.px-goddess-glow{position:absolute;left:22%;top:50%;width:40%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;
  background:radial-gradient(circle,rgba(255,255,230,.9),rgba(160,220,255,.35) 45%,transparent 70%);animation:px-pulse 2.4s ease-in-out infinite}
.px-goddess-img{position:relative;height:78%;image-rendering:pixelated;filter:drop-shadow(0 0 10px rgba(255,255,220,.9));animation:px-float 3s ease-in-out infinite}
.px-goddess-card{position:relative;width:46%;padding:.8em 1em;background:#f4fbff;border:4px solid #3a6aa3;border-radius:10px;color:#24365a;
  font-size:clamp(12px,2.1cqw,17px);line-height:1.5;box-shadow:0 6px 0 rgba(0,0,0,.3)}
.px-goddess-name{font-weight:700;margin-bottom:.3em;color:#3a6aa3}
.px-goddess-hint{margin-top:.4em;font-size:.8em;opacity:.6;text-align:right}
@keyframes px-fadein{from{opacity:0}to{opacity:1}}
@keyframes px-pulse{0%,100%{opacity:.7;transform:translate(-50%,-50%) scale(.95)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.05)}}
@keyframes px-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-3%)}}
.px-fade.sleep::after{content:"💤";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:clamp(28px,6cqw,56px)}
.px-pets{display:grid;gap:8px}
.px-pet-count{font-size:.85em;opacity:.75}
.px-pet-card{display:grid;grid-template-columns:4.2em 1fr;gap:.6em;align-items:start;padding:.5em;background:#fffaf0;border:2px solid #c99a6a;border-radius:6px}
.px-pet-card.companion{border-color:#e0a412;background:#fff6d8}
.px-pet-card.wild{border-color:#5b8fd6;background:#f2f7ff}
.px-pet-pic{width:4.2em;height:4.2em;display:grid;place-items:center;background:#ffe6bd;border:2px solid #6b3f22;border-radius:6px;overflow:hidden}
.px-pet-pic img{max-width:90%;max-height:90%;image-rendering:auto}
.px-pet-pic .px-slot-emoji{font-size:2em}
.px-pet-frame{width:92%;background-repeat:no-repeat}
.px-pet-info{display:grid;gap:4px;min-width:0}
.px-pet-name{font-weight:700}
.px-pet-bar{position:relative;height:1.15em;background:#e9d3b0;border:2px solid #6b3f22;border-radius:4px;overflow:hidden}
.px-pet-fill{position:absolute;inset:0 auto 0 0;background:#f2b45a}
.px-pet-bar.love .px-pet-fill{background:#f08aa0}
.px-pet-bar-text{position:relative;padding-left:.4em;font-size:.8em;line-height:1.15em}
.px-pet-skill{font-size:.85em;opacity:.8}
.px-pet-skill.on{opacity:1}
.px-pet-hint{font-size:.82em;opacity:.75}
.px-pet-guide{margin-top:.4em;padding-top:.5em;border-top:2px dashed #e9c48a;display:grid;gap:4px}
.px-pet-guide-title{font-weight:700}
.px-pet-guide-row{display:grid;grid-template-columns:2.2em 1fr;gap:.5em;align-items:center;font-size:.85em}
.px-pet-guide-row .px-pet-pic{width:2.2em;height:2.2em;border-width:1px}
.px-pet-guide-row .px-pet-pic .px-slot-emoji{font-size:1.2em}
.px-trade-btn.px-danger{background:#f6c0b4}
.px-subtitle{font-weight:700;margin:.7em 0 .35em}
.px-row-btns{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:.3em 0}
.px-short{color:#c0392b}
.px-cost{font-size:.92em}
.px-floor{min-width:7em;text-align:center;font-weight:700}
.px-input{font:inherit;border:2px solid #c99a6a;border-radius:4px;padding:.15em .4em;background:#fffaf0;color:#4a2b17}
.px-code{flex:1;min-width:12em;font-family:ui-monospace,Consolas,monospace;font-size:.85em}
.px-mini{position:absolute;left:50%;top:22%;transform:translateX(-50%);width:min(70%,420px);padding:.6em .8em;background:#fff3d6;border:4px solid #6b3f22;
  border-radius:8px;box-shadow:0 6px 0 rgba(0,0,0,.35);color:#4a2b17;font-size:clamp(12px,2cqw,16px);text-align:center;cursor:pointer;user-select:none}
.px-mini-bar{position:relative;height:1.3em;margin-top:.4em;background:#e9d3b0;border:2px solid #6b3f22;border-radius:4px;overflow:hidden}
.px-mini-zone{position:absolute;top:0;bottom:0;background:#8fd16f}
.px-mini-perfect{position:absolute;top:0;bottom:0;background:#ffd25e}
.px-mini-needle{position:absolute;top:-2px;bottom:-2px;width:4px;margin-left:-2px;background:#3b2433}
.px-mode{position:absolute;left:50%;bottom:2%;transform:translateX(-50%);padding:.25em .8em;background:rgba(59,36,51,.85);color:#fff3d6;
  border-radius:6px;font-size:clamp(11px,1.8cqw,15px);pointer-events:none;white-space:nowrap}
.px-hp{position:absolute;left:1.5%;bottom:2%;padding:.2em .6em;background:rgba(59,36,51,.85);color:#ffb3c6;border-radius:6px;font-size:clamp(11px,2cqw,16px);pointer-events:none}
.px-hud-cal{margin-top:2px;padding-top:3px;border-top:2px dashed #e9c48a;white-space:nowrap;text-align:center}
.px-codex-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(7.2em,1fr));gap:6px;margin-top:.6em}
.px-codex-card{display:grid;justify-items:center;gap:1px;padding:.45em .3em;border:2px solid #c99a6a;border-radius:6px;background:#fffaf0;text-align:center}
.px-codex-card.unknown{background:#efe2c6;border-style:dashed;color:#8a6a4c}
.px-codex-card.unknown .px-slot-emoji{filter:grayscale(1);opacity:.6}
.px-codex-name{font-weight:700}
.px-codex-where,.px-codex-count{font-size:.8em;opacity:.8}
.px-toasts{position:absolute;right:1.5%;top:calc(2% + clamp(36px,6.5cqw,54px));display:grid;gap:6px;justify-items:end;pointer-events:none}
.px-toast{padding:.35em .9em;background:#fff3d6;color:#4a2b17;border:3px solid #6b3f22;border-radius:6px;
  font-size:clamp(11px,1.9cqw,16px);box-shadow:0 3px 0 rgba(0,0,0,.3);animation:px-pop .2s ease-out;transition:opacity .35s,translate .35s}
.px-toast.out{opacity:0;translate:0 -6px}
@keyframes px-pop{from{opacity:0;translate:0 -8px}to{opacity:1;translate:0 0}}

.px-panel-body{padding:.6em .8em;overflow:auto}
.px-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:.6em}
.px-tab{border:2px solid #6b3f22;background:#ffe6bd;color:#4a2b17;border-radius:4px;padding:.15em .7em;cursor:pointer;font:inherit}
.px-tab.on{background:#6b3f22;color:#fff3d6}
.px-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(4.6em,1fr));gap:6px}
.px-slot{position:relative;display:grid;justify-items:center;gap:2px;padding:.4em .2em;border:2px solid #c99a6a;border-radius:6px;
  background:#fffaf0;cursor:pointer;font:inherit;color:inherit}
.px-slot:hover{border-color:#6b3f22;background:#fff}
.px-slot.selected{border-color:#5b8f3a;box-shadow:inset 0 0 0 2px #8fd16f}
.px-slot-emoji{font-size:1.8em;line-height:1.1}
.px-slot-emoji.has-icon{display:flex;align-items:center;justify-content:center;font-size:1em}
.px-icon{display:inline-block;background-image:var(--px-atlas);background-repeat:no-repeat;image-rendering:auto;flex:none}
.px-slot-count{position:absolute;right:4px;top:2px;font-size:.75em;font-variant-numeric:tabular-nums}
.px-slot-name{font-size:.75em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.px-slot-tag{position:absolute;left:3px;top:2px;font-size:.62em;background:#8fd16f;color:#24401a;border-radius:3px;padding:0 3px}
.px-empty,.px-greeting{padding:.6em;background:#fffaf0;border:2px dashed #c99a6a;border-radius:6px}
.px-greeting{border-style:solid;margin-bottom:.6em}
.px-hint{margin-top:.6em;font-size:.8em;opacity:.75}
.px-trades{display:grid;gap:6px}
.px-trade{display:grid;grid-template-columns:1fr auto 1fr auto;align-items:center;gap:.5em;padding:.45em .6em;background:#fffaf0;border:2px solid #c99a6a;border-radius:6px}
.px-trade.disabled{opacity:.55}
.px-arrow{font-weight:700;color:#b06a3a}
.px-trade-btn{border:2px solid #6b3f22;background:#8fd16f;color:#24401a;border-radius:4px;padding:.15em .7em;cursor:pointer;font:inherit}
.px-trade-btn:disabled{background:#e9d3b0;color:#8a6a48;cursor:not-allowed}

@keyframes px-frames{from{background-position-x:0%}to{background-position-x:100%}}
@keyframes px-blink{0%{opacity:1}100%{opacity:0}}

/* ── V0.6：所有 UI 都在地圖旁邊的側邊欄，不蓋在地圖上；側邊欄可以收合 ── */
.px-app{width:100%;container-type:inline-size;font-family:system-ui,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif}
.px-shell{display:flex;align-items:stretch;justify-content:center;gap:8px;width:100%}
.px-shell>.px-stage{flex:0 0 auto;min-width:0}
.px-side{position:relative;flex:1 1 auto;min-width:230px;max-width:420px;min-height:200px;background:#2d2238;border-radius:12px}
.px-side-inner{position:absolute;inset:0;display:flex;flex-direction:column;gap:7px;padding:8px;overflow-y:auto;overflow-x:hidden;color:#4a2b17;font-size:13px}
.px-side-inner>*{flex-shrink:0}
.px-side-inner>.px-backdrop{flex-shrink:1}
.px-side-top{display:flex;align-items:center;gap:6px;color:#fff3d6;font-size:12px;opacity:.85}
.px-side-top span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.px-side-toggle{border:2px solid #6b3f22;background:#fff3d6;color:#4a2b17;border-radius:6px;padding:0 .5em;font:inherit;font-size:13px;line-height:1.6;cursor:pointer}
.px-side-toggle:hover{background:#fff}
.px-side .px-hud{position:static;min-width:0;font-size:13px;background:#fff3d6}
.px-side .px-hud-btns{position:static;display:grid;grid-template-columns:repeat(auto-fill,minmax(40px,1fr));gap:6px;flex-direction:row}
.px-side .px-bag-btn{position:static;width:100%;max-width:48px;justify-self:center;font-size:21px}
.px-side .px-quest{position:static;max-width:none;width:100%;font-size:13px;white-space:normal}
.px-side-status{display:grid;gap:5px}
.px-side-status:empty{display:none}
.px-side .px-hp,.px-side .px-mode{position:static;transform:none;white-space:normal;font-size:12.5px;text-align:center}
.px-side .px-toasts{position:static;margin-top:auto;justify-items:stretch;gap:5px}
.px-side .px-toast{font-size:12.5px;padding:.3em .6em}
.px-side .px-backdrop{display:none;flex:1 1 auto;min-height:150px}
.px-side .px-backdrop.show{display:flex}
.px-panel{display:flex;flex-direction:column;background:#fff3d6;border:4px solid #6b3f22;border-radius:8px;
  box-shadow:inset 0 0 0 3px #e9c48a,0 4px 0 rgba(0,0,0,.35);color:#4a2b17;min-height:0}
.px-panel:focus{outline:none}
.px-side .px-panel{width:100%;height:100%;max-height:none;font-size:13.5px}
.px-panel-body{flex:1;min-height:0}
.px-panel-head{display:flex;align-items:center;gap:.5em;padding:.45em .6em;border-bottom:3px solid #e9c48a;font-weight:700}
.px-panel-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.px-panel-close,.px-panel-fold{border:2px solid #6b3f22;background:#ffe6bd;border-radius:4px;cursor:pointer;color:#4a2b17;font:inherit;padding:0 .45em}
.px-panel-fold:hover,.px-panel-close:hover{background:#fff}
.px-drawer-tab{display:none;width:100%;padding:.35em .6em;border:3px solid #6b3f22;border-radius:6px;background:#fff3d6;color:#4a2b17;font:inherit;
  font-size:13px;font-weight:700;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.px-drawer-tab.show{display:block}
.px-drawer-tab:hover{background:#fff}
/* 收合：只留一排按鈕，地圖變大 */
.px-shell.px-side-collapsed>.px-side{flex:0 0 58px;min-width:58px}
.px-side-collapsed .px-side-top span,.px-side-collapsed .px-hud,.px-side-collapsed .px-quest,.px-side-collapsed .px-backdrop,
.px-side-collapsed .px-drawer-tab,.px-side-collapsed .px-side-status{display:none !important}
.px-side-collapsed .px-side-inner{padding:8px 6px;align-items:center}
.px-side-collapsed .px-hud-btns{grid-template-columns:1fr}
/* 收合時提示還是要看得到：浮在側邊欄左邊 */
.px-side-collapsed .px-toasts{position:absolute;right:calc(100% + 8px);bottom:8px;width:max-content;max-width:300px;margin:0;z-index:5}
/* 窄的時候：側邊欄排到地圖下面 */
@container (max-width: 620px){
  .px-shell{flex-direction:column}
  .px-shell>.px-stage{width:100%}
  .px-side{flex:0 0 auto;height:300px;max-width:none}
  .px-shell.px-side-collapsed>.px-side{height:auto;min-height:0}
  .px-side-collapsed .px-side-inner{position:static}
  .px-side-collapsed .px-toasts{position:static;width:100%;max-width:none}
  .px-side-collapsed .px-side-inner{flex-direction:row;flex-wrap:wrap}
  .px-side-collapsed .px-hud-btns{grid-template-columns:repeat(auto-fill,minmax(40px,1fr));width:100%}
}

/* ── V0.6.2：經典 RPG 對話框（畫面中間偏下、半透明黑底白字、頭像在左），可以有選項 ── */
.px-dialog{left:50%;right:auto;bottom:5%;width:min(86%,800px);transform:translateX(-50%);background:rgba(14,10,24,.84);
  border:3px solid rgba(255,255,255,.85);border-radius:10px;box-shadow:0 0 0 3px rgba(0,0,0,.45),0 8px 20px rgba(0,0,0,.45);z-index:3}
.px-dialog.top{top:5%;bottom:auto}
.px-dialog-main{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:.55em}
.px-dialog-text{color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.6);align-self:stretch}
.px-dialog.done .px-dialog-text::after{color:#ffd86b}
.px-dialog.menu .px-dialog-text::after{display:none}
.px-dialog.menu{cursor:default}
.px-portrait{background-color:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.75)}
.px-name{background:#ffd86b;color:#2a1a10;border:2px solid #fff}
.px-dialog-choices{display:flex;flex-wrap:wrap;gap:6px}
.px-choice{border:2px solid rgba(255,255,255,.85);background:rgba(255,255,255,.08);color:#fff;border-radius:6px;padding:.25em .85em;
  font:inherit;font-size:clamp(12px,2cqw,17px);cursor:pointer;transition:background .1s}
.px-choice:hover,.px-choice:focus-visible{background:#ffd86b;color:#2a1a10;outline:none}
.px-choice:active{translate:0 2px;box-shadow:inset 0 2px 0 rgba(0,0,0,.4)}
.px-choice:disabled{opacity:.45;cursor:not-allowed;background:transparent;color:#ddd}

/* ── V0.6.2：按鈕狀態：不能按就是灰的，字直接寫原因（金幣不足／材料不足／已售罄） ── */
.px-trade-btn:disabled{background:#9ca3af;color:#f3f4f6;border-color:#6b7280;cursor:not-allowed;box-shadow:none}
.px-trade-btn:not(:disabled):hover{filter:brightness(1.06)}
.px-trade-btn:not(:disabled):active{translate:0 2px;box-shadow:inset 0 2px 0 rgba(0,0,0,.3)}
.px-trade.disabled{opacity:.75}
.px-trade.sold-out .px-get{text-decoration:line-through;opacity:.7}

/* ── V0.6.2：側邊欄按鈕：按下去、或對應的面板開著時，看起來是「壓下去」的 ── */
.px-bag-btn{transition:background .1s,translate .05s}
.px-bag-btn:active,.px-side .px-bag-btn.open{background:#e3b97a;translate:0 2px;box-shadow:inset 0 3px 0 rgba(0,0,0,.35),inset 0 0 0 2px #8a5a32}
.px-side .px-bag-btn.open{outline:2px solid #ffd86b;outline-offset:1px}

/* ── V0.6.2：獨立的模態視窗（商店等）：半透明黑幕蓋住整個遊戲 ── */
.px-shell{position:relative}
.px-modal-backdrop{position:absolute;inset:0;display:none;place-items:center;background:rgba(8,6,14,.6);z-index:20;border-radius:12px}
.px-modal-backdrop.show{display:grid;animation:px-fadein .15s ease-out}
.px-modal{width:min(660px,92%);max-height:88%;font-size:14px}
.px-modal .px-panel-body{overflow:auto}
.px-modal .px-panel-head{font-size:1.05em}
.px-modal-info{font-weight:700;background:#ffe6bd;border:2px solid #6b3f22;border-radius:6px;padding:0 .55em;white-space:nowrap}
.px-modal-close{font-size:1.05em;padding:0 .55em}

/* ── V0.7：數值低於 30%：進度條變紅、閃爍 ── */
.px-hud-row.low .px-hud-fill{background:#e5484d !important;animation:px-low 1s ease-in-out infinite}
.px-hud-row.low .px-hud-text,.px-hud-row.low .px-hud-icon{color:#c62828;font-weight:700}
.px-hud-row.low .px-hud-bar{box-shadow:0 0 0 2px rgba(229,72,77,.35)}
@keyframes px-low{0%,100%{opacity:1}50%{opacity:.45}}
@media (prefers-reduced-motion: reduce){.px-hud-row.low .px-hud-fill{animation:none}}
/* ── V0.18：她的小願望（側邊欄，任務下面） ── */
.px-wish{display:grid;grid-template-columns:1fr auto;gap:.1em .5em;align-items:center;width:100%;text-align:left;font:inherit;font-size:13px;padding:.4em .6em;background:linear-gradient(#fff4fa,#ffe6f0);border:2px solid #e9a3bd;border-radius:8px;color:#5a2a3c;cursor:pointer;box-shadow:0 2px 0 rgba(0,0,0,.18)}
.px-wish[hidden]{display:none}
.px-wish-label{grid-column:1/-1;font-size:.78em;font-weight:800;color:#b5527a}
.px-wish-text{font-weight:700;line-height:1.3}
.px-wish-reward{font-size:.8em;font-weight:800;color:#d23d6e;white-space:nowrap}
.px-wish.done{background:linear-gradient(#f2fff2,#dff6df);border-color:#8cc98c;color:#2f5a2f}
.px-wish.done .px-wish-reward{color:#2f8a3a}
.px-wish:hover{filter:brightness(1.03)}
/* ── V0.17：鯨魚娘的像素日記 ── */
.px-hud-btns .px-bag-btn.has-new,.px-side .px-bag-btn.has-new{position:relative}
.px-bag-btn.has-new::after{content:'';position:absolute;top:3px;right:3px;width:9px;height:9px;border-radius:50%;background:#e8455a;box-shadow:0 0 0 2px #fff6e6;animation:px-badge-pulse 1.6s ease-in-out infinite}
@keyframes px-badge-pulse{50%{transform:scale(1.25)}}
.px-ai-settings{display:grid;gap:.55em;max-width:34em}
.px-ai-lead{margin:0;line-height:1.5}
.px-ai-now{padding:.35em .6em;border-radius:6px;font-weight:700;border:2px solid #c9a46e;background:#fff7e3}
.px-ai-now.on{border-color:#5aa36a;background:#eefae9;color:#2f6b3a}
.px-ai-row{display:flex;gap:.4em}
.px-ai-input{flex:1;min-width:0;font:inherit;padding:.4em .55em;border:2px solid #6b3f22;border-radius:6px;background:#fffdf6;color:#3a2412}
.px-ai-input:focus{outline:3px solid #7fd0ff;outline-offset:1px}
.px-ai-status{padding:.35em .6em;border-radius:6px;line-height:1.45}
.px-ai-status.ok{background:#eefae9;color:#2f6b3a}
.px-ai-status.bad{background:#fdecea;color:#9b2c22}
.px-ai-status.busy{background:#eef3fb;color:#3a5a8a}
.px-ai-notes{margin:0;padding-left:1.1em;font-size:.86em;line-height:1.5;opacity:.85;display:grid;gap:.2em}
.px-diary{display:grid;gap:.5em}
.px-diary-book{position:relative;display:grid;grid-template-columns:1.6em 1fr;background:#8a5a32;border:3px solid #4f2f17;border-radius:8px;padding:.45em .45em .45em .2em;box-shadow:0 4px 0 rgba(0,0,0,.25)}
.px-diary-rings{background:radial-gradient(circle at 50% 50%,#d9d4c7 0 .28em,#6b6458 .3em .38em,transparent .4em) 0 .5em/100% 1.6em repeat-y}
.px-diary-page{position:relative;min-height:12em;padding:.6em .9em .7em 1.4em;border-radius:4px;color:#3e2a1a;background:linear-gradient(90deg,transparent 0 1em,rgba(214,90,90,.55) 1em 1.1em,transparent 1.1em),repeating-linear-gradient(#fffaf0 0 1.75em,#cfe0ef 1.75em 1.82em);background-color:#fffaf0}
.px-diary-head{display:flex;justify-content:space-between;gap:.5em;font-weight:800;font-size:.9em;color:#7a4b25;margin-bottom:.15em}
.px-diary-text{font-size:1.18em;line-height:1.75em;letter-spacing:.04em;font-weight:600;min-height:3.5em;white-space:pre-wrap;word-break:break-word;font-family:"Kaiti TC","STKaiti","BiauKai","DFKai-SB","KaiTi",serif}
.px-diary-text.typing::after{content:'▍';animation:px-caret .7s steps(1) infinite;color:#c27a2c}
@keyframes px-caret{50%{opacity:0}}
.px-diary-text.pending{display:flex;align-items:center;gap:.4em;color:#8a6a4a;font-size:1em}
.px-diary-pencil{display:inline-block;animation:px-pencil .5s ease-in-out infinite alternate;transform-origin:20% 80%}
@keyframes px-pencil{from{transform:rotate(-12deg) translateX(-2px)}to{transform:rotate(8deg) translateX(3px)}}
.px-diary-sign{text-align:right;font-size:.85em;color:#7a4b25;margin-top:.2em}
.px-diary-facts{margin-top:.55em;padding:.35em .55em;background:rgba(255,236,170,.6);border:1px dashed #d1a95e;border-radius:4px;font-size:.78em}
.px-diary-facts-title{font-weight:800;margin-bottom:.1em}
.px-diary-facts ul{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:.15em 1.1em}
.px-diary-facts li::before{content:'・'}
.px-diary-nav{align-items:center}
.px-diary-count{font-size:.85em;opacity:.75;min-width:4em;text-align:center}
.px-diary-empty{padding:1em;text-align:center;background:#fffaf0;border:2px dashed #d9b98a;border-radius:6px}
@media (prefers-reduced-motion: reduce){.px-diary-pencil,.px-bag-btn.has-new::after{animation:none}}
/* ── V0.16：時間與天氣木牌（遊戲畫面角落） ── */
.px-clock{position:absolute;top:2%;width:17em;aspect-ratio:480/147;font-size:clamp(9px,1.6cqw,15px);display:grid;grid-template-columns:auto 1fr;align-items:center;gap:0 .55em;padding:0 1.3em 0 1.25em;box-sizing:border-box;pointer-events:none;color:#4a2a12;font-weight:800;line-height:1.2;text-shadow:0 1px 0 rgba(255,236,196,.75)}
.px-clock[hidden]{display:none}
.px-clock.top-right{right:1.5%}
.px-clock.top-left{left:1.5%}
.px-clock-bg,.px-clock-night{position:absolute;inset:0;pointer-events:none}
.px-clock-bg{background:var(--px-clock-board) center/100% 100% no-repeat;filter:drop-shadow(0 3px 0 rgba(0,0,0,.35))}
.px-clock-night{background:linear-gradient(rgba(20,34,96,.62),rgba(30,48,120,.5));mix-blend-mode:multiply;-webkit-mask:var(--px-clock-board) center/100% 100% no-repeat;mask:var(--px-clock-board) center/100% 100% no-repeat;opacity:0;transition:opacity 1.2s ease}
.px-clock.night .px-clock-night{opacity:1}
.px-clock.night{color:#fff1cf;text-shadow:0 1px 0 #2a170b,1px 0 0 #2a170b,-1px 0 0 #2a170b,0 -1px 0 #2a170b}
.px-clock-weather,.px-clock-text{position:relative;min-width:0}
.px-clock-weather{display:grid;justify-items:center;gap:.05em}
.px-clock-wicon{display:grid;place-items:center;width:2.35em;height:2.35em;font-size:1em;line-height:1}
.px-clock-wicon:not(.img){font-size:1.7em;width:1.4em;height:1.4em}
.px-clock-wname{font-size:.72em;white-space:nowrap}
.px-clock-text{display:grid;gap:.12em}
.px-clock-line{display:flex;align-items:center;gap:.3em;white-space:nowrap;font-size:1.02em}
.px-clock-time{font-variant-numeric:tabular-nums}
.px-clock-sicon.img{width:1.15em;height:1.15em}
.px-clock .img{background:var(--px-clock-icons) no-repeat;background-size:calc(var(--px-clock-icon-count) * 100%) 100%;background-position:calc(var(--i) / (var(--px-clock-icon-count) - 1) * 100%) 0;image-rendering:auto}
.px-clock-wicon.bounce{animation:px-clock-bounce .55s cubic-bezier(.3,1.4,.5,1)}
@keyframes px-clock-bounce{0%{transform:scale(1)}30%{transform:scale(1.38)}55%{transform:scale(.86)}78%{transform:scale(1.08)}100%{transform:scale(1)}}
@media (prefers-reduced-motion: reduce){.px-clock-wicon.bounce{animation:none}.px-clock-night{transition:none}}
/* ── V0.16：坐下來吃飯、零食桌、冰箱 ── */
.px-modal-backdrop[data-dock]{background:rgba(8,6,14,.16);padding:2%}
.px-modal-backdrop[data-dock=right]{justify-items:end}
.px-modal-backdrop[data-dock=left]{justify-items:start}
.px-modal-backdrop[data-dock] .px-modal{width:min(420px,46%);max-height:94%}
.px-meal-title{font-weight:700;margin:.5em 0 .3em;font-size:.9em}
.px-meal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:.4em;max-height:34vh;overflow:auto;padding:.1em}
.px-meal-food{position:relative;display:grid;justify-items:center;gap:1px;padding:.35em .2em .3em;background:#fffaf0;border:2px solid #d9b98a;border-radius:6px;cursor:pointer;font:inherit;color:inherit;transition:transform .08s}
.px-meal-food:hover:not(:disabled){transform:translateY(-2px);border-color:#c27a2c}
.px-meal-food:disabled{opacity:.5;cursor:default}
.px-meal-food.liked{border-color:#e98aa8;background:#fff3f6}
.px-meal-name{font-size:.78em;font-weight:700;line-height:1.15;text-align:center}
.px-meal-gain{font-size:.7em;opacity:.8}
.px-meal-count{position:absolute;top:2px;right:4px;font-size:.7em;font-weight:700;color:#6b3f22}
.px-meal-empty{text-align:center;padding:.5em;background:#fffaf0;border:2px dashed #d9b98a;border-radius:6px;display:grid;gap:.4em}
.px-meal-line{background:#fffaf0;border:2px solid #c99a6a;border-radius:6px;padding:.35em .5em;min-height:0}
.px-meal-snack{display:grid;justify-items:center;gap:.35em;padding:.5em;background:linear-gradient(#f8e2b8,#eac78c);border:3px solid #8a5a32;border-radius:8px}
.px-meal-plate{display:flex;gap:.25em;padding:.2em .7em;background:radial-gradient(ellipse,#fff 0 55%,#d8d8e8 56% 70%,transparent 71%);font-size:1.5em}
.px-meal-plate .off{opacity:.18;filter:grayscale(1)}
.px-meal-snack-text{font-size:.82em}
.px-fridge-wrap{display:grid;justify-items:center;gap:.35em}
.px-fridge{position:relative;width:9.5em;height:8.6em;perspective:400px;margin:1.3em 0 1em 4.5em}
.px-fridge-inside{position:absolute;inset:0;display:grid;grid-template-rows:1fr 1.2fr 1fr;background:linear-gradient(#e9f6ff,#cfe6f5);border:4px solid #f4ecd9;outline:3px solid #6b5a48;border-radius:10px;padding:.35em .45em;gap:.2em}
.px-fridge-shelf{display:flex;align-items:center;justify-content:center;gap:.3em;border-bottom:3px solid #b9d3e4;font-size:1.05em}
.px-fridge-shelf.low{border-bottom:none;background:rgba(160,200,170,.35);border-radius:4px}
.px-fridge-find{position:relative;display:inline-grid;place-items:center}
.px-fridge.fresh .px-fridge-find{animation:px-fridge-pop .5s cubic-bezier(.3,1.6,.6,1) both .3s}
.px-fridge-door{position:absolute;inset:0;display:grid;place-items:center;font-size:1.6em;color:#3d5a88;background:linear-gradient(90deg,#fbf6ea,#efe4cc);border:3px solid #6b5a48;border-radius:10px;transform-origin:left center}
.px-fridge.opening .px-fridge-door{animation:px-fridge-rattle .3s ease-in-out infinite alternate}
.px-fridge.open .px-fridge-door{transform:rotateY(-108deg)}
.px-fridge.open.fresh .px-fridge-door{animation:px-fridge-door .55s cubic-bezier(.5,0,.3,1) both}
.px-fridge-light{position:absolute;inset:-8px;border-radius:14px;pointer-events:none}
.px-fridge.open .px-fridge-light{box-shadow:0 0 22px 6px rgba(190,230,255,.75)}
.px-fridge.open.fresh .px-fridge-light{animation:px-fridge-glow .7s ease-out both}
@keyframes px-fridge-door{from{transform:rotateY(0)}to{transform:rotateY(-108deg)}}
@keyframes px-fridge-rattle{from{transform:rotateY(0)}to{transform:rotateY(-6deg)}}
@keyframes px-fridge-glow{from{box-shadow:0 0 0 0 rgba(190,230,255,0)}to{box-shadow:0 0 22px 6px rgba(190,230,255,.75)}}
.px-fridge-msg{font-weight:700;text-align:center}
.px-fridge-line{font-size:.85em;opacity:.85;text-align:center}
@keyframes px-fridge-pop{from{transform:scale(0) translateY(8px);opacity:0}to{transform:none;opacity:1}}
/* 揹包：選了食物之後的「餵她吃」列 */
.px-eat{display:flex;align-items:center;gap:.6em;margin:.4em 0;padding:.45em .6em;background:#fffaf0;border:2px solid #c99a6a;border-radius:6px}
.px-eat-info{flex:1;min-width:0;display:grid;gap:2px}
.px-eat-name{font-weight:700}
.px-eat-gain{font-size:.9em}
.px-eat-btn{white-space:nowrap}
/* V0.22：社交（碼、聊天室、交易所、攤位、信箱、串門） */
.px-code-box{margin:.35em 0}
.px-code-out,.px-code-in{resize:vertical;min-height:2.6em;word-break:break-all;line-height:1.3}
.px-code-out.px-flash,.px-visit-code.px-flash{animation:px-code-flash 1.2s ease-out 2}
@keyframes px-code-flash{0%{box-shadow:0 0 0 3px #ffb547;background:#fff4d6}100%{box-shadow:0 0 0 0 transparent}}
/* 串門視窗（畫面正中央）：寬的碼框、按鈕放在框的正下方 */
.px-visit-entry{display:flex;gap:8px;flex-wrap:wrap;margin:.3em 0}
.px-visit-entry .px-big-btn{flex:1 1 9em}
.px-big-btn{font-size:1.05em;font-weight:800;padding:.45em .9em;border-radius:6px;box-shadow:0 3px 0 rgba(0,0,0,.25)}
.px-big-btn:active:not(:disabled){translate:0 2px;box-shadow:0 1px 0 rgba(0,0,0,.25)}
.px-big-btn:disabled{opacity:.55;cursor:default}
.px-visit-modal{position:relative}
.px-visit-tabs .px-tab{font-size:1em;padding:.3em .9em}
.px-visit-code{display:block;width:100%;height:80px;box-sizing:border-box;margin:.5em 0 0;padding:.4em .55em;resize:vertical;
  font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:11px;line-height:1.4;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere}
.px-visit-code[readonly]{background:#fff6e2}
.px-visit-meta{margin-top:.3em}
.px-visit-actions{display:flex;gap:10px;margin-top:.7em}
.px-visit-actions .px-big-btn{flex:1}
.px-visit-close{background:#f3d9b5;color:#4a2b17}
.px-visit-go{background:#7fc4ff;color:#14304a}
.px-visit-error{margin-top:.5em;padding:.35em .6em;border:2px solid #e5484d;border-radius:6px;background:#ffecec;color:#a82326;font-weight:700}
.px-visit-again{display:flex;align-items:center;gap:8px;margin-top:.8em;padding-top:.55em;border-top:2px dashed #d9b98a}
.px-visit-again .px-hint{flex:1;margin:0}
.px-visit-remake{white-space:nowrap}
.px-modal-toast{position:absolute;left:50%;top:3.2em;transform:translateX(-50%);z-index:5;pointer-events:none;max-width:90%;text-align:center;
  padding:.55em 1.1em;border-radius:8px;border:3px solid #1d3a1d;background:#3a7a3a;color:#fff;font-weight:800;box-shadow:0 4px 0 rgba(0,0,0,.3);
  animation:px-fadein .15s ease-out;transition:opacity .35s}
.px-modal-toast.err{background:#8a2a2a;border-color:#5a1414}
.px-modal-toast.hide{opacity:0}
.px-copy-btn{white-space:nowrap}
.px-chat-banner{font-size:.85em;padding:.35em .55em;border-radius:6px;background:#fff1c9;border:2px dashed #c99a6a;margin-bottom:.4em}
.px-chat-banner.server{background:#e4f7dd;border-style:solid;border-color:#7cb36a}
.px-chat-list{max-height:16em;overflow-y:auto;display:grid;gap:4px;padding:.3em;background:#fffaf0;border:2px solid #c99a6a;border-radius:6px}
.px-chat-msg{display:grid;grid-template-columns:auto 1fr auto;gap:.15em .5em;align-items:baseline;padding:.2em .35em;border-radius:5px}
.px-chat-msg.from-me{background:#e3f1ff}
.px-chat-msg.from-bot{background:#fff6e4}
.px-chat-msg.from-server{background:#eef9ea}
.px-chat-msg.from-system{grid-template-columns:1fr auto;background:transparent;font-size:.85em;opacity:.75}
.px-chat-msg.from-system .px-chat-who{display:none}
.px-chat-who{font-weight:700;white-space:nowrap}
.px-chat-tag{font-size:.7em;font-weight:400;margin-left:.3em;padding:0 .3em;border-radius:3px;background:#c99a6a;color:#fff}
.px-chat-text{word-break:break-word}
.px-chat-time{font-size:.7em;opacity:.55;white-space:nowrap}
.px-chat-input input{flex:1;min-width:8em}
.px-market-coins{font-weight:700;margin:.2em 0 .4em}
.px-market-list{display:grid;gap:4px}
.px-market-row{display:grid;grid-template-columns:1fr auto auto auto;gap:.6em;align-items:center;padding:.3em .5em;background:#fffaf0;border:2px solid #c99a6a;border-radius:6px}
.px-market-name{font-weight:700}
.px-market-stock{font-size:.85em;opacity:.75}
.px-stall-form select{max-width:12em}
.px-stall-row{margin:.35em 0;padding:.4em .55em;background:#fffaf0;border:2px solid #c99a6a;border-radius:6px}
.px-stall-row.sold{background:#eef9ea;border-color:#7cb36a}
.px-stall-row.cancelled{opacity:.6}
.px-stall-row .px-code-box{flex:1;margin:0}
.px-fair{margin-top:.6em}
.px-letter{margin:.35em 0;padding:.45em .6em;background:#fffaf0;border:2px solid #c99a6a;border-radius:6px}
.px-letter.unread{border-color:#e07a5f;box-shadow:0 0 0 2px rgba(224,122,95,.25)}
.px-letter-head{font-size:.85em;opacity:.8;margin-bottom:.2em}
.px-letter-text{white-space:pre-wrap;word-break:break-word}
.px-letter-input{width:100%;box-sizing:border-box;resize:vertical}
.px-adopt{margin-top:.8em;padding-top:.4em;border-top:2px dashed #c99a6a}
.px-visit-bar{position:absolute;left:50%;bottom:6px;transform:translateX(-50%);z-index:6;display:flex;gap:8px;align-items:center;padding:.3em .6em;border-radius:8px;background:rgba(36,24,44,.82);color:#fff3d6;font-weight:700;white-space:nowrap;max-width:calc(100% - 16px);overflow:hidden}
.px-visit-bar .px-trade-btn{font-weight:400}
`;

export function ensurePixelStyles(doc: Document): void {
  if (doc.getElementById('px-stage-css')) return;
  const style = doc.createElement('style');
  style.id = 'px-stage-css';
  style.textContent = PIXEL_CSS;
  doc.head.append(style);
}
