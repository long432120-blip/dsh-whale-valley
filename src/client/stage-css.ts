// 樣式寫成字串、執行時注入：DSH 客戶端插件不必處理 CSS 打包。
// 全部 class 加 wp- 前綴，避免跟宿主或其他插件撞名；不碰宿主 DOM。
export const STAGE_CSS = /* css */ `
.wp-stage{position:relative;width:100%;overflow:hidden;border-radius:16px;background:#cfe6ff;
  container-type:inline-size;user-select:none;-webkit-user-select:none;
  font-family:system-ui,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif}
.wp-bg{position:absolute;inset:0;background:center/cover no-repeat}
.wp-tint{position:absolute;inset:0;pointer-events:none;transition:background-color 1.2s}
.wp-stage[data-phase=evening] .wp-tint{background:rgba(255,140,80,.16)}
.wp-stage[data-phase=night] .wp-tint{background:rgba(25,35,90,.40)}

.wp-hotspots{position:absolute;inset:0}
.wp-hotspot{position:absolute;border:0;padding:0;margin:0;background:transparent;cursor:pointer;border-radius:10px}
.wp-hotspot:hover,.wp-hotspot:focus-visible{background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 3px rgba(255,255,255,.75);outline:none}
.wp-hotspot>span{position:absolute;left:50%;top:-2.4em;translate:-50% 0;white-space:nowrap;padding:.25em .75em;
  border-radius:999px;background:rgba(255,255,255,.94);color:#33384f;font-size:clamp(11px,1.8cqw,15px);
  box-shadow:0 2px 8px rgba(40,60,120,.18);opacity:0;transition:opacity .2s;pointer-events:none}
.wp-hotspot:hover>span,.wp-hotspot:focus-visible>span{opacity:1}

.wp-pet{position:absolute;translate:-50% 0;cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent}
.wp-pet:focus-visible .wp-sprite{filter:drop-shadow(0 0 6px #fff) drop-shadow(0 2px 2px rgba(0,0,0,.15))}
.wp-shadow{position:absolute;left:50%;bottom:-2%;width:58%;height:7%;translate:-50% 0;border-radius:50%;
  background:rgba(30,40,70,.24);filter:blur(2px)}
.wp-body{position:absolute;inset:0;transform-origin:50% 100%}
.wp-sprite{width:100%;height:100%;background-repeat:no-repeat;background-position:0 0;
  filter:drop-shadow(0 2px 2px rgba(0,0,0,.15))}
.wp-sprite.flip{transform:scaleX(-1)}
.wp-body.walking{animation:wp-bob .52s ease-in-out infinite}
.wp-body.hop{animation:wp-hop .45s ease-out}

.wp-bubble{--shift:-50%;position:absolute;bottom:100%;left:50%;translate:var(--shift) -10%;
  width:max-content;max-width:min(55cqw,320px);padding:.55em .95em;border-radius:14px;background:#fff;color:#2b2f45;
  font-size:clamp(12px,2.1cqw,17px);line-height:1.45;box-shadow:0 4px 14px rgba(40,60,120,.2);
  opacity:0;scale:.85;transform-origin:50% 100%;transition:opacity .18s,scale .18s;pointer-events:none}
.wp-bubble::after{content:"";position:absolute;top:100%;left:calc(-1 * var(--shift));translate:-50% 0;
  border:8px solid transparent;border-top-color:#fff}
.wp-bubble.show{opacity:1;scale:1}
.wp-pet[data-align=left] .wp-bubble{--shift:-18%}
.wp-pet[data-align=right] .wp-bubble{--shift:-82%}

.wp-fade{position:absolute;inset:0;background:#0d1330;opacity:0;pointer-events:none;transition:opacity .28s}
.wp-fade.on{opacity:1;pointer-events:auto}

@keyframes wp-frames{from{background-position-x:0%}to{background-position-x:100%}}
@keyframes wp-bob{0%,50%,100%{transform:translateY(0) rotate(0)}25%{transform:translateY(-3%) rotate(-1.5deg)}
  75%{transform:translateY(-3%) rotate(1.5deg)}}
@keyframes wp-hop{0%{transform:none}30%{transform:translateY(-10%) scale(.96,1.04)}
  60%{transform:translateY(0) scale(1.05,.95)}100%{transform:none}}
@media (prefers-reduced-motion:reduce){.wp-body.walking,.wp-body.hop{animation:none}}
`;

export function ensureStyles(doc: Document): void {
  if (doc.getElementById('wp-stage-css')) return;
  const style = doc.createElement('style');
  style.id = 'wp-stage-css';
  style.textContent = STAGE_CSS;
  doc.head.append(style);
}
