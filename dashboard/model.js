// The radar's value model, shared by main.ts and the dashboard page.
//
// One function scores every protocol, from the snapshot's own figures only: the
// protocol's TVL, its seven-day TVL growth, and how long it has run with no token
// on record. No protocol name is ever special-cased, and no row is hand-picked.
//
//   implied = round( tvl_usd x base_multiple x growth_factor x maturity_factor )
//
//   growth_factor   = 1 + clamp(change_7d, floor, cap) / 100 x growth_weight
//   maturity_factor = maturity_floor + min(age_days, maturity_days) / maturity_days x maturity_range
//
// The base multiple is not chosen by hand: main.ts calibrates it from the same
// snapshot as the median market-cap-to-TVL ratio of the protocols whose token
// already trades, and ships it in data.js with the rest of the constants. The page
// recomputes every row with this same function and checks the number board.json
// carries, so the screenshots, the page and the board can never disagree.
//
// Loaded two ways: as a classic script it sets window.RadarModel; required from
// Node (main.ts imports it) it exports the same object. No imports, no network.

(function (root) {
  'use strict';

  var DAY_MS = 86400000;

  /** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
  function ageDays(asOf, listedAt) {
    if (listedAt === null || listedAt === undefined) return null;
    var a = Date.parse(asOf + 'T00:00:00Z');
    var b = Date.parse(listedAt + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.max(0, Math.floor((a - b) / DAY_MS));
  }

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  function round4(n) {
    return Math.round(n * 1e4) / 1e4;
  }

  /**
   * The implied value one protocol gets under the constants `c`.
   * `row` carries tvl_usd, change_7d (null when unreported) and age_days (null when
   * the listing date is unknown). Returns the implied value and every factor, so the
   * detail view can show the arithmetic instead of only the answer.
   */
  function impliedValue(row, c) {
    var rawGrowth = typeof row.change_7d === 'number' && isFinite(row.change_7d) ? row.change_7d : 0;
    var growthPct = clamp(rawGrowth, c.growth_floor, c.growth_cap);
    var growthMult = 1 + (growthPct / 100) * c.growth_weight;
    var age = typeof row.age_days === 'number' && isFinite(row.age_days) ? row.age_days : c.unknown_age_days;
    var maturityMult =
      c.maturity_floor + (Math.min(Math.max(age, 0), c.maturity_days) / c.maturity_days) * c.maturity_range;
    var implied = Math.max(1, Math.round(row.tvl_usd * c.base_multiple * growthMult * maturityMult));
    return {
      implied_value_usd: implied,
      growth_pct: growthPct,
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
    };
  }

  var api = { ageDays: ageDays, impliedValue: impliedValue };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RadarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
