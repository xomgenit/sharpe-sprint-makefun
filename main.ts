// Dip buyer for the pump.fun replay (agent-fun/replay/v2).
//
// The ranking metric is hourly Sharpe on a 6-hour forward window, so the bot
// optimises for many small, controlled round trips rather than one moonshot.
// It only touches coins that already proved demand (real reserve >= 15 SOL —
// most pump.fun coins die long before that), and only buys weakness: a dip of
// at least 10% below the peak of the last 20 trades. Exits are mechanical and
// quick — take-profit +8%, stop-loss -4%, and a 1200-slot time stop — so no
// position rides a volatility spike and hourly returns stay smooth. Each mint
// is traded at most once, which keeps the round trips spread across the
// >= 20 distinct mints the guardrails require. Every fill lands 2 slots after
// the decision, so the entry waits for the dip to print instead of chasing
// strength into the lag.
//
// Deterministic by construction: no randomness, no wall clock, no network.
// Decisions depend only on the batch stream, processed in chain order.

import { LAMPORTS_PER_SOL, runBot, type OrderInput } from './vendor/makefun-bot.ts';

// ---- tunables ---------------------------------------------------------------
const STAKE = (LAMPORTS_PER_SOL * 3n) / 100n; // 0.03 SOL per trade
const MIN_BUY = (LAMPORTS_PER_SOL * 12n) / 1000n; // 0.012 SOL floor (guardrail is 0.01)
const MIN_RESERVE = LAMPORTS_PER_SOL * 15n; // proven demand only: >= 15 SOL real reserve
const MIN_TRADES = 15; // coin must have a real trade history first
const PEAK_WINDOW = 20; // trades back for the recent-peak read
const DIP_FACTOR = 0.9; // buy at <= 90% of the recent peak (a >= 10% dip)
const TAKE_PROFIT = 1.08; // sell at +8% over entry
const STOP_LOSS = 0.96; // sell at -4% under entry
const MAX_HOLD_SLOTS = 1200; // time stop (~8 minutes of slots)
const BUY_SLIPPAGE_BPS = 600;
const SELL_SLIPPAGE_BPS = 10_000; // exits must never be refused

// ---- per-mint memory --------------------------------------------------------
interface OpenTrade {
  entryPrice: number;
  entrySlot: number;
}

const prices = new Map<string, number[]>(); // spot price after each trade, oldest first
const open = new Map<string, OpenTrade>();
const traded = new Set<string>(); // mints already traded: breadth first, no re-entry

function spot(virtualQuote: bigint, virtualToken: bigint): number {
  if (virtualToken === 0n) return 0;
  return Number(virtualQuote) / Number(virtualToken);
}

await runBot({
  onBatch(state, batch) {
    const orders: OrderInput[] = [];
    const caps = state.hello.caps;
    const txFee = state.txFeeLamports();
    let free = state.freeCashLamports();
    let slotsFree = caps.max_open_positions - state.committedPositionCount();

    // Learn from fills: remember the true entry price of each filled buy.
    for (const f of batch.fills) {
      if (f.side === 'buy' && f.status === 'filled' && BigInt(f.token_amount) > 0n) {
        const px = Number(BigInt(f.quote_lamports)) / Number(BigInt(f.token_amount));
        open.set(f.mint, { entryPrice: px, entrySlot: f.slot });
      }
      if (f.side === 'sell' && f.status === 'filled') open.delete(f.mint);
    }

    // Fold this batch's trades into the per-mint price tapes.
    for (const e of batch.events) {
      if (e.event !== 'TradeEvent') continue;
      let tape = prices.get(e.mint);
      if (tape === undefined) {
        tape = [];
        prices.set(e.mint, tape);
      }
      tape.push(spot(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves)));
      if (tape.length > 64) tape.shift();
    }

    // Exits first: free slots and cash before considering new entries.
    for (const [mint, pos] of state.positions) {
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      const px = spot(curve.virtual_quote_reserves, curve.virtual_token_reserves);
      const trade = open.get(mint);
      if (trade === undefined || px <= 0) continue;
      const takeProfit = px >= trade.entryPrice * TAKE_PROFIT;
      const stopLoss = px <= trade.entryPrice * STOP_LOSS;
      const stale = batch.slot - trade.entrySlot >= MAX_HOLD_SLOTS;
      if (!takeProfit && !stopLoss && !stale) continue;
      if (orders.length >= caps.max_orders_per_batch) break;
      if (free < txFee) break;
      orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: SELL_SLIPPAGE_BPS });
      free -= txFee;
      open.delete(mint);
    }

    // Entries: fresh mints only, in the order their trades appear in this batch.
    const seen = new Set<string>();
    for (const e of batch.events) {
      if (e.event !== 'TradeEvent' || seen.has(e.mint)) continue;
      seen.add(e.mint);
      if (orders.length >= caps.max_orders_per_batch || slotsFree <= 0) break;
      if (traded.has(e.mint) || state.positions.has(e.mint)) continue;
      const curve = state.curves.get(e.mint);
      if (curve === undefined || curve.complete) continue;
      if (curve.trades < MIN_TRADES) continue;
      if (curve.real_quote_reserves < MIN_RESERVE) continue;
      const tape = prices.get(e.mint);
      if (tape === undefined || tape.length < PEAK_WINDOW) continue;
      const now = tape[tape.length - 1];
      let peak = 0;
      for (const p of tape.slice(-PEAK_WINDOW)) if (p > peak) peak = p;
      if (peak <= 0 || now > peak * DIP_FACTOR) continue;
      const cap = state.maxBuyLamports(e.mint);
      const amount = cap < STAKE ? cap : STAKE;
      if (amount < MIN_BUY) continue;
      if (free < amount + txFee) continue;
      orders.push({ side: 'buy', mint: e.mint, quote_lamports: amount, max_slippage_bps: BUY_SLIPPAGE_BPS });
      free -= amount + txFee;
      slotsFree -= 1;
      traded.add(e.mint);
    }

    return orders;
  },
});
