// V0.17：鯨魚娘的像素日記。
//   - 白天：每個成功的動作都記進「今天的紀錄」（dayLog）：釣了幾條魚、種了幾顆菜、餵她吃了什麼…
//   - 睡覺：把今天的紀錄變成一篇日記。規則層（host、demo 共用）先用 diary.json 的句子拼一篇（一定有）；
//     DSH 的 host 再把同一份紀錄丟給 DeepSeek，寫出 50 字以內的日記換上去（失敗就留著拼的那篇）。
// 這個檔案是純函數，不碰網路、不碰 API Key。
import type { GameEvent, GameplayDefs } from './gameplay-types.ts';

/** diary.json：拼日記用的句子（全部資料驅動） */
export interface DiaryFile {
  version: 1;
  /** 日記最多幾個字（AI 和拼出來的都一樣） */
  maxChars: number;
  /** 存檔最多留幾篇（舊的丟掉） */
  keep: number;
  /** 一件事的寫法：{n} = 數量、{item} = 東西的名字、{npc} = 居民名字、{name} = 寵物名字 */
  facts: Record<DiaryFactKey, string>;
  /** 天氣的寫法（天氣 id → 一小句）；沒寫的用「天氣名稱。」 */
  weather: Record<string, string>;
  /** 開頭：{weather} = 上面那一小句；{season} = 「冬季第2天」（日記本上已經有日期，通常不用寫） */
  openers: string[];
  /** 結尾 */
  closers: string[];
  /** 今天什麼都沒做 */
  empty: string[];
}

/** 會寫進日記的事（照這個順序挑最重要的） */
export const DIARY_FACTS = [
  'married', 'wish', 'legendary', 'firstFish', 'levelUp', 'petCaught', 'fish', 'harvested', 'planted', 'fed', 'gifted',
  'mine', 'tavernWin', 'played', 'headpat', 'bathed', 'snacked', 'fridge', 'foraged', 'animals', 'furniture', 'sold', 'watered', 'talked',
] as const;
export type DiaryFactKey = (typeof DIARY_FACTS)[number];

/** 今天的紀錄 */
export interface DayLog {
  /** 從什麼時候開始記（上次起床） */
  since: number;
  counts: Partial<Record<DiaryFactKey, number>>;
  /** 每件事的「代表」：最常出現的東西（例如釣到最多的魚、吃了什麼） */
  items: Partial<Record<DiaryFactKey, Record<string, number>>>;
}

/** 一篇日記 */
export interface DiaryEntry {
  id: string;
  /** 寫日記的時間（睡覺的那一刻，遊戲時間） */
  at: number;
  /** 「冬季第 2 天」 */
  date: string;
  weather: { id: string; name: string; emoji: string };
  /** 今天的紀錄（一行一件事，給 AI 看、也顯示在日記下面） */
  facts: string[];
  text: string;
  /** template = 用 diary.json 拼的；ai = DeepSeek 寫的 */
  source: 'template' | 'ai';
  /** host 正在請 AI 寫（畫面顯示「她正在寫日記…」） */
  pending?: boolean;
  /** 開始請 AI 寫的時間（host 的時鐘）；太久沒寫完（host 重開、當掉）就當作沒在寫 */
  pendingSince?: number;
  read: boolean;
}

export function emptyLog(now: number): DayLog {
  return { since: now, counts: {}, items: {} };
}

/** 讀存檔：壞掉的欄位丟掉 */
export function normalizeLog(raw: unknown, now: number): DayLog {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const keys = new Set<string>(DIARY_FACTS);
  const counts: DayLog['counts'] = {};
  if (r.counts && typeof r.counts === 'object') {
    for (const [k, v] of Object.entries(r.counts)) if (keys.has(k) && typeof v === 'number' && v > 0) counts[k as DiaryFactKey] = v;
  }
  const items: DayLog['items'] = {};
  if (r.items && typeof r.items === 'object') {
    for (const [k, v] of Object.entries(r.items)) {
      if (!keys.has(k) || !v || typeof v !== 'object') continue;
      const m = Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === 'number' && n > 0)) as Record<string, number>;
      if (Object.keys(m).length) items[k as DiaryFactKey] = m;
    }
  }
  return { since: typeof r.since === 'number' ? r.since : now, counts, items };
}

/** 請 AI 寫日記最多等多久；超過就當作沒寫成（留拼出來的那篇） */
export const DIARY_PENDING_MS = 120_000;

export function normalizeDiary(raw: unknown, keep: number, now = 0): DiaryEntry[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string' && typeof (e as { text?: unknown }).text === 'string')
    .map((e) => {
      const w = (e.weather && typeof e.weather === 'object' ? e.weather : {}) as Record<string, unknown>;
      return {
        id: str(e.id, 40),
        at: typeof e.at === 'number' ? e.at : 0,
        date: str(e.date, 20),
        weather: { id: str(w.id, 20), name: str(w.name, 10), emoji: str(w.emoji, 8) },
        facts: Array.isArray(e.facts) ? e.facts.filter((x): x is string => typeof x === 'string').slice(0, 12).map((x) => x.slice(0, 60)) : [],
        text: str(e.text, 200),
        source: e.source === 'ai' ? ('ai' as const) : ('template' as const),
        read: e.read === true,
        // 還在「寫」：太久了（host 重開、當掉）就當作沒寫成，留拼出來的那篇
        ...(e.pending === true && typeof e.pendingSince === 'number' && now - e.pendingSince < DIARY_PENDING_MS && now >= e.pendingSince
          ? { pending: true, pendingSince: e.pendingSince }
          : {}),
      };
    })
    .slice(-keep);
}

function bump(log: DayLog, k: DiaryFactKey, n = 1, item?: string): DayLog {
  if (!(n > 0)) return log;
  const counts = { ...log.counts, [k]: (log.counts[k] ?? 0) + n };
  if (!item) return { ...log, counts };
  const m = { ...(log.items[k] ?? {}) };
  m[item] = (m[item] ?? 0) + n;
  return { ...log, counts, items: { ...log.items, [k]: m } };
}

/** 一個成功的動作 → 記進今天的紀錄（不重要的動作原樣回傳） */
export function logEvent(log: DayLog, e: GameEvent, d: GameplayDefs): DayLog {
  let l = log;
  const up = (x: { levelUp?: string }) => {
    if (x.levelUp) l = bump(l, 'levelUp', 1, x.levelUp);
  };
  switch (e.type) {
    case 'caught': {
      // 釣到垃圾（空罐子、舊靴子）不算魚
      if (d.items.get(e.item)?.category === 'junk') break;
      l = bump(l, 'fish', e.count, e.item);
      if (e.rarity === 'legendary') l = bump(l, 'legendary', 1, e.item);
      else if (e.first) l = bump(l, 'firstFish', 1, e.item);
      break;
    }
    case 'planted':
      l = bump(l, 'planted', 1, e.crop);
      break;
    case 'harvested':
      l = bump(l, 'harvested', e.count, e.item);
      break;
    case 'watered':
      l = bump(l, 'watered');
      break;
    case 'fed':
      l = bump(l, 'fed', 1, e.item);
      up(e);
      break;
    case 'gifted':
      l = bump(l, 'gifted', 1, e.npc);
      break;
    case 'talked':
      l = bump(l, 'talked', 1, e.npc);
      break;
    case 'mine_returned':
      l = bump(l, 'mine', 1, String(e.report.reached));
      break;
    case 'coin_flipped':
      if (e.win) l = bump(l, 'tavernWin');
      up(e);
      break;
    case 'cards_played':
      if (e.outcome === 'win') l = bump(l, 'tavernWin');
      break;
    case 'play_stopped':
      l = bump(l, 'played', Math.max(1, e.minutes), e.game);
      up(e);
      break;
    case 'bathed':
      l = bump(l, 'bathed');
      up(e);
      break;
    case 'snacked':
      l = bump(l, 'snacked');
      up(e);
      break;
    case 'fridge_opened':
      if (e.item) l = bump(l, 'fridge', 1, e.item);
      break;
    case 'foraged':
      l = bump(l, 'foraged', 1, e.item);
      break;
    case 'animals_collected':
    case 'animal_petted':
    case 'animals_fed':
      l = bump(l, 'animals');
      break;
    case 'pet_caught':
      l = bump(l, 'petCaught', 1, e.name);
      break;
    case 'furniture_bought':
    case 'placed':
      l = bump(l, 'furniture', 1, e.item);
      break;
    case 'sold':
      l = bump(l, 'sold', e.coins);
      break;
    case 'married':
      l = bump(l, 'married');
      break;
    case 'headpat':
      l = bump(l, 'headpat');
      up(e);
      break;
  }
  return l;
}

/** 最常出現的那一個（同樣多就取先記的） */
function top(m: Record<string, number> | undefined): string | undefined {
  let best: string | undefined;
  let n = 0;
  for (const [k, v] of Object.entries(m ?? {})) if (v > n) [best, n] = [k, v];
  return best;
}

/** 今天的紀錄 → 一行一件事（照重要程度排好） */
export function dayFacts(log: DayLog, d: GameplayDefs, file: DiaryFile): { key: DiaryFactKey; text: string }[] {
  const out: { key: DiaryFactKey; text: string }[] = [];
  for (const k of DIARY_FACTS) {
    const n = log.counts[k];
    if (!n) continue;
    // 釣到的魚都已經寫成「第一次釣到」「傳說的魚」了：不用再寫一次「釣到 1 條魚」
    if (k === 'fish' && n <= (log.counts.firstFish ?? 0) + (log.counts.legendary ?? 0)) continue;
    const id = top(log.items[k]);
    const crop = id ? d.crops.get(id) : undefined;
    const item = id ? (d.items.get(id)?.name ?? (crop ? d.items.get(crop.harvest.item)?.name : undefined) ?? '') : '';
    const npc = id ? (d.file.npcs?.[id]?.name ?? '') : '';
    const game = k === 'played' && id ? (d.file.leisure?.play.games[id]?.name ?? '') : '';
    const t = file.facts[k];
    if (!t) continue;
    // 願望：{item} = 願望的內容（例如「今天好想吃蜂蜜鬆餅～」）
    if (k === 'wish') {
      out.push({ key: k, text: t.replace('{item}', (id ?? '').replace(/[～！。…]+$/, '')) });
      continue;
    }
    out.push({
      key: k,
      text: t
        .replace('{n}', String(Math.round(n)))
        .replace('{item}', item || game || '')
        .replace('{npc}', npc)
        .replace('{name}', id ?? '')
        .replace('{level}', id ?? '')
        .replace('{floor}', id ?? ''),
    });
  }
  return out;
}

/** 字數（中文、emoji 都算一個） */
export const charLen = (s: string) => [...s].length;

/**
 * 用 diary.json 的句子拼一篇日記：開頭（季節、天氣）＋最重要的一兩件事＋結尾；超過字數就少放一點。
 * rnd：規則層的亂數（存檔決定，重算結果一樣）
 */
export function templateDiary(
  facts: { key: DiaryFactKey; text: string }[],
  ctx: { date: string; weatherId: string; weatherName: string },
  file: DiaryFile,
  rnd: () => number,
): string {
  const pick = (a: string[]) => a[Math.floor(rnd() * a.length) % Math.max(1, a.length)] ?? '';
  const weather = file.weather[ctx.weatherId] ?? `${ctx.weatherName}。`;
  const opener = pick(file.openers).replace('{season}', ctx.date).replace('{weather}', weather);
  const closer = pick(file.closers);
  if (!facts.length) return clip(`${opener}${pick(file.empty)}`, file.maxChars);
  const body = facts.slice(0, 2).map((f) => f.text);
  // 依序嘗試：兩件事＋結尾 → 一件事＋結尾 → 兩件事 → 一件事；都太長就截斷
  for (const parts of [[...body, closer], [body[0]!, closer], body, [body[0]!]]) {
    const t = `${opener}${parts.map(sentence).join('')}`;
    if (charLen(t) <= file.maxChars) return t;
  }
  return clip(`${opener}${sentence(body[0]!)}`, file.maxChars);
}

/** 一件事變成一句（沒有結尾標點就補「。」） */
function sentence(s: string): string {
  return /[。！？～…!?]$/.test(s) ? s : `${s}。`;
}

function clip(s: string, max: number): string {
  const c = [...s];
  return c.length <= max ? s : `${c.slice(0, max - 1).join('')}…`;
}

/** host 用：AI 寫好的日記換上去（只換還在、而且還是拼的那篇） */
export function setDiaryText(diary: DiaryEntry[], id: string, text: string | null): DiaryEntry[] {
  return diary.map((e) => {
    if (e.id !== id) return e;
    const { pending: _p, pendingSince: _s, ...rest } = e;
    return text ? { ...rest, text, source: 'ai' as const } : rest;
  });
}

/** host 用：標記「正在寫」 */
export function markDiaryPending(diary: DiaryEntry[], id: string, since: number): DiaryEntry[] {
  return diary.map((e) => (e.id === id ? { ...e, pending: true, pendingSince: since } : e));
}

/** 給模型的 user 訊息：日期、天氣、今天的紀錄 */
export function diaryPrompt(e: Pick<DiaryEntry, 'date' | 'weather' | 'facts'>, extra: string[] = []): string {
  return [
    `日期：${e.date}`,
    `天氣：${e.weather.name}`,
    '今天發生的事：',
    ...(e.facts.length ? e.facts.map((f) => `- ${f}`) : ['- 沒做什麼特別的事，一直待在主人身邊']),
    ...extra,
  ].join('\n');
}

/** 檢查 diary.json */
export function validateDiary(f: DiaryFile | undefined): string[] {
  if (!f) return [];
  const out: string[] = [];
  if (!(f.maxChars >= 10 && f.maxChars <= 200)) out.push('diary.json：maxChars 要在 10～200');
  if (!(f.keep >= 1)) out.push('diary.json：keep 要 ≥ 1');
  for (const k of DIARY_FACTS) if (!f.facts?.[k]) out.push(`diary.json：facts 缺「${k}」`);
  for (const k of ['openers', 'closers', 'empty'] as const) if (!Array.isArray(f[k]) || !f[k].length) out.push(`diary.json：${k} 至少要一句`);
  for (const o of f.openers ?? []) if (charLen(o) > f.maxChars / 2) out.push(`diary.json：開頭「${o}」太長（要留字給今天的事）`);
  return out;
}
