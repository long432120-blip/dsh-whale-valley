// 極簡 JSON 存檔：原子寫入 + 單寫者佇列 + 壞檔備份。
// 不依賴任何 DSH API，可以單獨測試。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class JsonStore<T> {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly file = 'save.json',
  ) {}

  get path(): string {
    return join(this.dir, this.file);
  }

  /** 讀原始內容；沒檔案回傳 undefined；JSON 壞掉就改名備份後當作沒檔案 */
  async read(): Promise<unknown> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      await rename(this.path, `${this.path}.corrupt-${Date.now()}`);
      return undefined;
    }
  }

  /**
   * 讀 → 算 → 寫，全部排隊執行。tool 和 UI 同時寫入也不會互相蓋掉。
   * fn 回傳 { next: 要存的內容, result: 要回給呼叫端的值 }
   */
  update<R>(fn: (raw: unknown) => { next: T; result: R }): Promise<R> {
    const run = async () => {
      const { next, result } = fn(await this.read());
      await this.write(next);
      return result;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private async write(data: T): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, this.path); // 同一磁碟上的 rename 是原子操作：不會留下寫一半的存檔
  }
}
