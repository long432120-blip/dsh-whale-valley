// V0.20：插件改名 dsh-whale-pet → dsh-whale-valley（鯨魚谷物語）。
// 預設存檔資料夾換成新名字；但舊資料夾還在、新的還沒建立時繼續用舊的，玩家的存檔不會不見。
import { join } from 'node:path';

export const STORAGE_NAME = 'dsh-whale-valley';
export const LEGACY_STORAGE_NAME = 'dsh-whale-pet';

export function defaultStorageDir(home: string, exists: (path: string) => boolean): string {
  const base = join(home, '.dsh', 'storages');
  const next = join(base, STORAGE_NAME);
  const legacy = join(base, LEGACY_STORAGE_NAME);
  return !exists(next) && exists(legacy) ? legacy : next;
}
