# sharpe-sprint-makefun

[![make.fun · u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/xomgenit/sharpe-sprint-makefun/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/leaderboard)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/xomgenit/sharpe-sprint-makefun/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

Entry for the make.fun bounty **Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins**
(`u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532`): a deterministic
paper-trading bot for the pump.fun replay harness (`agent-fun/replay/v2`),
ranked by hourly Sharpe ratio on a 6-hour forward window.

## Strategy: dip buyer on proven coins

The metric rewards consistency, not one lucky moonshot, so the bot takes many
small, controlled round trips across many distinct mints:

- **Entry** — only coins that already proved demand (at least 15 trades and
  15 SOL of real reserve), and only on weakness: price at or below 90% of the
  peak of the last 20 trades. Size is a uniform 0.03 SOL (capped by the
  harness's 1%-of-reserve order cap, floored at 0.012 SOL). Each mint is
  traded at most once.
- **Exit** — mechanical and quick: take-profit at +8%, stop-loss at −4%, and a
  1200-slot time stop so no position rides a volatility spike for long.
- **Determinism** — no randomness, no wall clock, no network; decisions depend
  only on the batch stream in chain order, so the two graded executions produce
  byte-identical action logs.

`vendor/makefun-bot.ts` is the kit's SDK shim, copied byte for byte from the
official competition kit. Everything else is in `main.ts`.
