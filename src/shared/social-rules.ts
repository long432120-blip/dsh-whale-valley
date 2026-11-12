// V0.22：社交動作（交易所、攤位、領養、串門、信箱、暱稱）。由 gameplay.ts 的 run() 轉過來。
// 全部是純函數；碼的格式在 codec.ts，欄位範圍檢查在 trade.ts。
import { COIN, type ActError, type GameAction, type GameEvent, type GameplayDefs, type GameState, type PetState } from './gameplay-types.ts';
import { addItem } from './gameplay.ts';
import { decodeCode, encodeCode } from './codec.ts';
import { makeFilter } from './profanity.ts';
import { dayKey } from './time.ts';
import {
  checkPet, checkReceipt, checkReply, checkStall, cleanName, DAY, HOUR, marketOffers, petPayload, stallPriceRange,
  type Letter, type ReceiptPayload, type StallListing, type StallPayload, type TradeState, type VisitPayload,
} from './trade.ts';

type Outcome = { ok: true; game: GameState; event: GameEvent } | { ok: false; error: ActError };
const ok = (game: GameState, event: GameEvent): Outcome => ({ ok: true, game, event });
const fail = (error: ActError): Outcome => ({ ok: false, error });

type SocialActionType =
  | 'set_nick' | 'market_buy' | 'stall_list' | 'stall_cancel' | 'trade_buy' | 'trade_receipt'
  | 'pet_adopt_out' | 'pet_adopt_in' | 'visit_snapshot' | 'visit_reply' | 'mail_read';
export type SocialAction = Extract<GameAction, { type: SocialActionType }>;
const SOCIAL = new Set<string>(['set_nick', 'market_buy', 'stall_list', 'stall_cancel', 'trade_buy', 'trade_receipt',
  'pet_adopt_out', 'pet_adopt_in', 'visit_snapshot', 'visit_reply', 'mail_read'] satisfies SocialActionType[]);
export const isSocialAction = (a: GameAction): a is SocialAction => SOCIAL.has(a.type);

const nonceOf = (rnd: () => number, now: number) => `${Math.floor(rnd() * 2 ** 32).toString(36)}${(now % 2 ** 30).toString(36)}`;
const coins = (g: GameState) => g.inventory[COIN] ?? 0;
/** 兌換紀錄最多留多久（碼本身都有期限，過期的紀錄可以丟） */
const REDEEM_KEEP = 60 * DAY;
const prune = (r: Record<string, number>, now: number) =>
  Object.fromEntries(Object.entries(r).filter(([, at]) => now - at < REDEEM_KEEP));

/** 拜訪時給朋友看的東西：農場、家具、動物、寵物、她的好感；不放揹包、日記、任務、交易紀錄 */
export function visitSnapshot(g: GameState): Record<string, unknown> {
  return {
    placed: g.placed, decor: g.decor, plots: g.plots, sprinklers: g.sprinklers, unlocked: g.unlocked,
    buildingLevels: g.buildingLevels, machines: g.machines, animals: g.animals, nextAnimalId: g.nextAnimalId,
    pets: g.pets.map((p) => ({ ...p, lastPetDay: '' })), nextPetId: g.nextPetId, companion: g.companion,
    affection: g.affection, marriedAt: g.marriedAt, clockOffset: g.clockOffset,
  };
}

export function runSocial(g: GameState, a: SocialAction, d: GameplayDefs, now: number, rnd: () => number): Outcome {
  const s = d.file.social;
  if (!s) return fail('unknown');
  const t: TradeState = g.trade;
  const put = (trade: Partial<TradeState>, extra: Partial<GameState> = {}): GameState => ({ ...g, ...extra, trade: { ...t, ...trade } });
  switch (a.type) {
    case 'set_nick': {
      const nick = makeFilter(s.chat)(cleanName(a.nick, s.nick.maxLength)).text;
      if (!nick) return fail('unknown');
      return ok(put({ nick }), { type: 'nick_set', nick });
    }

    case 'market_buy': {
      const today = dayKey(now);
      const bought = t.market.day === today ? t.market.bought : {};
      const offer = marketOffers(d, now, bought).find((o) => o.item === a.item);
      const qty = Math.floor(a.qty);
      if (!offer) return fail('not_for_sale');
      if (!(qty >= 1) || qty > offer.left) return fail('sold_out');
      const cost = offer.price * qty;
      if (coins(g) < cost) return fail('no_item');
      const inv = addItem(addItem(g.inventory, COIN, -cost), a.item, qty);
      return ok(put({ market: { day: today, bought: { ...bought, [a.item]: (bought[a.item] ?? 0) + qty } } }, { inventory: inv }),
        { type: 'market_bought', item: a.item, qty, cost });
    }

    case 'stall_list': {
      const range = stallPriceRange(d, a.item);
      const qty = Math.floor(a.qty);
      const price = Math.floor(a.price);
      if (!range) return fail('not_for_sale');
      if (!(qty >= 1 && qty <= s.stall.maxQty)) return fail('unknown');
      if (!(price >= range[0] && price <= range[1])) return fail('bad_price');
      if ((g.inventory[a.item] ?? 0) < qty) return fail('no_item');
      if (t.stall.filter((l) => l.status === 'open').length >= s.stall.maxListings) return fail('no_room');
      const id = nonceOf(rnd, now);
      const payload: StallPayload = { v: 1, id, from: t.id, nick: t.nick, item: a.item, qty, price, at: now };
      const code = encodeCode('stall', payload, s.salt);
      const listing: StallListing = { id, item: a.item, qty, price, at: now, status: 'open', code };
      // 先扣住：攤位上的東西不在揹包裡，不能同時賣給兩邊
      return ok(put({ stall: [...t.stall, listing].slice(-20) }, { inventory: addItem(g.inventory, a.item, -qty) }),
        { type: 'stall_listed', listing, code });
    }

    case 'stall_cancel': {
      const l = t.stall.find((x) => x.id === a.id);
      if (!l || l.status !== 'open') return fail('gone');
      return ok(put({ stall: t.stall.map((x) => (x === l ? { ...x, status: 'cancelled' as const } : x)) }, { inventory: addItem(g.inventory, l.item, l.qty) }),
        { type: 'stall_cancelled', id: l.id, item: l.item, qty: l.qty });
    }

    case 'trade_buy': {
      const dec = decodeCode(a.code, s.salt, 'stall');
      const p = dec.ok ? checkStall(dec.payload, d, now) : null;
      if (!p) return fail('bad_code');
      if (p.from === t.id) return fail('own_code');
      const key = `stall:${p.from}:${p.id}`;
      if (t.redeemed[key]) return fail('already');
      const total = p.qty * p.price;
      if (coins(g) < total) return fail('no_item');
      const rp: ReceiptPayload = { v: 1, id: p.id, to: p.from, buyer: t.id, nick: t.nick, qty: p.qty, total, at: now };
      const receipt = encodeCode('receipt', rp, s.salt);
      const inv = addItem(addItem(g.inventory, COIN, -total), p.item, p.qty);
      return ok(put({ redeemed: { ...prune(t.redeemed, now), [key]: now } }, { inventory: inv }),
        { type: 'trade_bought', item: p.item, qty: p.qty, total, seller: p.nick, receipt });
    }

    case 'trade_receipt': {
      const dec = decodeCode(a.code, s.salt, 'receipt');
      const p = dec.ok ? checkReceipt(dec.payload, d, now) : null;
      if (!p) return fail('bad_code');
      if (p.to !== t.id) return fail('not_yours');
      const l = t.stall.find((x) => x.id === p.id);
      if (!l) return fail('bad_code');
      if (l.status === 'sold') return fail('already');
      if (l.status === 'cancelled') return fail('gone');
      // 收款碼裡的數量、金額要跟攤位上的一模一樣
      if (p.qty !== l.qty || p.total !== l.qty * l.price) return fail('bad_code');
      return ok(put({
        stall: t.stall.map((x) => (x === l ? { ...x, status: 'sold' as const, buyer: p.nick } : x)),
        redeemed: { ...prune(t.redeemed, now), [`receipt:${p.id}`]: now },
      }, { inventory: addItem(g.inventory, COIN, p.total) }), { type: 'trade_collected', id: l.id, total: p.total, buyer: p.nick });
    }

    case 'pet_adopt_out': {
      const pet = g.pets.find((p) => p.id === a.pet);
      if (!pet) return fail('unknown');
      const readyAt = t.adoptCodeAt + s.adopt.cooldownHours * HOUR;
      if (t.adoptCodeAt && now < readyAt) return fail('cooldown');
      const nonce = nonceOf(rnd, now);
      const code = encodeCode('pet', petPayload(pet, t, nonce, now), s.salt);
      // 轉移不複製：寵物離開你家
      return ok(put({ adoptCodeAt: now }, { pets: g.pets.filter((p) => p !== pet), companion: g.companion === pet.id ? null : g.companion }),
        { type: 'pet_adopt_code', pet: pet.id, name: pet.name, code });
    }

    case 'pet_adopt_in': {
      const dec = decodeCode(a.code, s.salt, 'pet');
      const p = dec.ok ? checkPet(dec.payload, d, now) : null;
      if (!p) return fail('bad_code');
      const key = `pet:${p.from}:${p.id}`;
      if (t.redeemed[key]) return fail('already');
      if (g.pets.length >= (d.file.pets?.maxPets ?? 0)) return fail('too_many_pets');
      let name = p.name;
      for (let i = 2; g.pets.some((x) => x.name === name); i++) name = `${p.name}${i}`;
      const pet: PetState = { id: g.nextPetId, kind: p.kind, name, affection: p.affection, satiety: p.satiety, lastPetDay: '', obtainedAt: now, how: 'adopt' };
      return ok(put({ redeemed: { ...prune(t.redeemed, now), [key]: now } }, { pets: [...g.pets, pet], nextPetId: pet.id + 1 }),
        { type: 'pet_adopted', pet: pet.id, kind: p.kind, name, from: p.from === t.id ? '' : p.nick });
    }

    case 'visit_snapshot': {
      const payload: VisitPayload = { v: 1, from: t.id, nick: t.nick, at: now, scene: 'garden', game: visitSnapshot(g) };
      return ok(g, { type: 'visit_snapshot', payload });
    }

    case 'visit_reply': {
      const dec = decodeCode(a.code, s.salt, 'reply');
      const p = dec.ok ? checkReply(dec.payload, d, now) : null;
      if (!p) return fail('bad_code');
      if (p.to !== t.id) return fail('not_yours');
      const key = `reply:${p.from}:${p.at}`;
      if (t.redeemed[key]) return fail('already');
      // 同一天的回信才算澆水（隔天田早就乾了）；只澆還種著東西、還沒濕的田
      let plots = g.plots;
      let watered = 0;
      const hours = d.file.farming?.waterHours ?? 0;
      if (hours && dayKey(p.at) === dayKey(now)) {
        for (const id of p.watered) {
          const plot = plots[id];
          if (!plot || plot.wateredUntil > now) continue;
          plots = { ...plots, [id]: { ...plot, wateredUntil: now + hours * HOUR } };
          watered++;
        }
      }
      const letter: Letter = { id: `l${nonceOf(rnd, now)}`, from: p.from, nick: makeFilter(s.chat)(p.nick).text, text: makeFilter(s.chat)(p.text).text, at: p.at, watered, read: false };
      return ok(put({ redeemed: { ...prune(t.redeemed, now), [key]: now } }, { plots, mailbox: [...g.mailbox, letter].slice(-s.mailbox.keep) }),
        { type: 'letter_received', letter, watered });
    }

    case 'mail_read':
      return ok({ ...g, mailbox: g.mailbox.map((l) => (l.read ? l : { ...l, read: true })) }, { type: 'mail_read' });
  }
}
