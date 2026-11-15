# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/aboys25/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/aboys25/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: every protocol on the watchlist and every pre-token protocol below it, ranked by an implied value computed from the snapshot's own figures (TVL, seven-day growth, time run with no token), with a farm plan for each. The value is a comps curve — least squares of log market cap on log TVL, fitted at run time on the snapshot's traded protocols, with a shrunken per-category yardstick — tested blind by leave-one-out refits and a time-split test, with the band the backtest earns on every row; each farm plan is netted at the band's low end to a FARM, THIN or SKIP verdict. The dashboard recomputes every row with the same functions that wrote the board.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=kg74h5f2&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
