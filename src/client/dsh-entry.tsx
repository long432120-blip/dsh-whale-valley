// DSH 客戶端入口（package.json 的 exports["./client"] 指向這裡打包後的檔案）。
// 像素版渲染器；角色包在打包時整個內嵌（清單在 pixel/bundled-pack.ts）。
//
// 已對照實機 DSH 0.2.1-rc.5 確認：
//   1. 槽位名稱 'shell.overlay' 確實存在（dsh-client-ui-chat / -layout / -schedule 等 8 個官方套件在用）
//   2. slots 服務由 @deepseek-ai/dsh-client-ui-renderer 提供（super(ctx, 'slots')）
//   3. 正確寫法是先 ctx.slots.inject(key, () => ...) 再 register，
//      這樣槽位還沒宣告時會等它宣告，而不是直接失敗
//   4. package.json 的 dsh.client.inject 要列 @deepseek-ai/dsh-client-ui-layout
//      （原本寫的 @deepseek-ai/dsh-client-ui-slots 這個套件不存在）
import { useEffect, useRef } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import { createDshBridge, fetchTransport } from './bridge-dsh.ts';
import { bundledPack } from './pixel/bundled-pack.ts';
import { loadPixelPack } from './pixel/pack-loader.ts';
import type { PixelStageHandle } from './pixel/pixel-stage.ts';
import { mountGame } from './game-shell.ts';
import { i18n } from './i18n.ts';

const source = bundledPack;

export const name = 'dsh-whale-valley-client';
export const inject = ['slots'] as const;

/** slots 服務的最小介面（宿主沒有出貨 .d.ts） */
interface SlotsService {
  inject(key: string, callback: () => unknown): () => void;
  register(spec: { name: string; id: string; inject?: () => Record<string, unknown> }, component: unknown): () => void;
}

function WhalePetPanel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let handle: PixelStageHandle | undefined;
    let cancelled = false;
    loadPixelPack(source)
      .then((pack) =>
        // V0.22：選了簡體只轉插件自己的區塊，不動 DSH 的介面
        (i18n().install(document, ref.current!, { title: false }),
        mountGame(ref.current!, {
          pack,
          // 通道：POST /api/dsh-whale-valley/<method>（host 端在 src/host/index.ts 註冊）
          bridge: createDshBridge(fetchTransport()),
          pollMs: 30_000,
        })),
      )
      .then((h) => (cancelled ? h.dispose() : (handle = h)))
      .catch((err) => console.error('[whale-pet] 啟動失敗', err));
    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, []);
  // 寬度 ≥ 320px 才能用 1 倍以上的整數放大；DSH 浮層建議給 640px（2 倍）
  return <div ref={ref} style={{ width: 640, maxWidth: '92vw' }} />;
}

export function apply(ctx: Context) {
  const slots = (ctx as unknown as { slots: SlotsService }).slots;
  // inject 會等到 'shell.overlay' 被宣告才執行 register，並在槽位收起時自動卸載
  slots.inject('shell.overlay', () =>
    slots.register(
      {
        name: 'shell.overlay',
        id: 'whale-pet',
      },
      WhalePetPanel,
    ),
  );
}
