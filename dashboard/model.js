// The radar's value model, shared by main.ts and the dashboard page: a
// comps curve fitted at run time, never a hand-chosen multiple:
//
//   implied = round( curve(tvl) x category x growth x maturity )
//   curve(tvl) = exp(intercept + slope x ln(tvl))  (least squares on comps)
//   category   = exp(shrunken median log-residual of the category's comps)
//   growth     = 1 + clamp(change_7d, floor, cap) / 100 x growth_weight
//   maturity   = floor + min(age, days) / days x range
//
// The slope is well below 1, so one flat multiple would overvalue the
// biggest protocols many times over. The band is the backtest's miss.
//
// Classic script: sets window.RadarModel. Required from Node: exports the
// same object. No imports, no network; fixed-seed bootstrap, so runs agree.

(function (root) {
  'use strict';

  var DAY_MS = 86400000;

  /** Whole days from `listedAt` to `asOf`, clamped at zero; null when a date is absent or bad. */
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

  /** The median; the list is left untouched. */
  function median(values) {
    if (values.length === 0) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** A nearest-rank percentile; p in [0, 1]. */
  function percentile(values, p) {
    if (values.length === 0) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  }

  /** Least squares of ln(market cap) on ln(TVL) over `comps`. A slope below 1
   * is the finding: big protocols trade at smaller multiples. */
  function fitCurve(comps) {
    var n = comps.length;
    var xs = [], ys = [], mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { xs.push(Math.log(comps[i].tvl_usd)); ys.push(Math.log(comps[i].mcap_usd)); mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    var sxy = 0, sxx = 0;
    for (i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
    var slope = sxx > 0 ? sxy / sxx : 0;
    return { intercept: my - slope * mx, slope: slope };
  }

  /** Each category's yardstick: the median log-residual of its comps, shrunk
   * by n/(n+k) so thin categories barely move the curve. */
  function categoryAdjustments(comps, fit, k) {
    // Null-prototype accumulators, so `__proto__` is a key like any other.
    var byCat = Object.create(null);
    comps.forEach(function (p) {
      var cat = p.category || 'Other';
      var residual = Math.log(p.mcap_usd) - (fit.intercept + fit.slope * Math.log(p.tvl_usd));
      (byCat[cat] = byCat[cat] || []).push(residual);
    });
    var out = Object.create(null);
    Object.keys(byCat).forEach(function (cat) {
      var list = byCat[cat];
      out[cat] = (list.length / (list.length + k)) * median(list);
    });
    return out;
  }

  /** The growth and maturity tilts for one row under `c`. */
  function tilts(row, c) {
    var rawGrowth = typeof row.change_7d === 'number' && isFinite(row.change_7d) ? row.change_7d : 0;
    var growthPct = clamp(rawGrowth, c.growth_floor, c.growth_cap);
    var growthMult = 1 + (growthPct / 100) * c.growth_weight;
    var age = typeof row.age_days === 'number' && isFinite(row.age_days) ? row.age_days : c.unknown_age_days;
    var maturityMult = c.maturity_floor + (Math.min(Math.max(age, 0), c.maturity_days) / c.maturity_days) * c.maturity_range;
    return { growth_pct: growthPct, growth_multiplier: growthMult, maturity_multiplier: maturityMult };
  }

  /** A category's yardstick, or 0; the own-property check defeats prototype names. */
  function adjOf(adjustments, cat) {
    return Object.prototype.hasOwnProperty.call(adjustments, cat) ? adjustments[cat] : 0;
  }

  /** The log of the predicted value for one row. */
  function predictLog(row, fit, adjustments, c) {
    var t = tilts(row, c);
    var adj = adjOf(adjustments, row.category || 'Other');
    return fit.intercept + fit.slope * Math.log(Math.max(1, row.tvl_usd)) + adj + Math.log(t.growth_multiplier * t.maturity_multiplier);
  }

  /** The implied value under the fitted constants `c`, with its band (the
   * value times and divided by the backtest's miss) and every factor, so the
   * detail view can show the arithmetic. */
  function impliedValue(row, c) {
    var t = tilts(row, c);
    var adj = adjOf(c.category, row.category || 'Other');
    var curveUsd = Math.exp(c.curve_intercept + c.curve_slope * Math.log(Math.max(1, row.tvl_usd)));
    var implied = Math.max(1, Math.round(curveUsd * Math.exp(adj) * t.growth_multiplier * t.maturity_multiplier));
    var band = c.band_factor > 1 ? c.band_factor : 1;
    return {
      implied_value_usd: implied,
      low_usd: Math.max(1, Math.round(implied / band)),
      high_usd: Math.round(implied * band),
      curve_usd: Math.max(1, Math.round(curveUsd)),
      category_multiplier: round4(Math.exp(adj)),
      growth_pct: t.growth_pct,
      growth_multiplier: round4(t.growth_multiplier),
      maturity_multiplier: round4(t.maturity_multiplier),
    };
  }

  /** The blind test: leave-one-out, each comp predicted by a curve fitted on
   * the others alone. Returns the median miss (the band), the 80th
   * percentile, and the share inside x2. */
  function looValidate(comps, c) {
    var errs = [];
    for (var i = 0; i < comps.length; i++) {
      var train = comps.slice(0, i).concat(comps.slice(i + 1));
      var fit = fitCurve(train);
      var adj = categoryAdjustments(train, fit, c.shrink_k);
      var held = comps[i];
      var row = { tvl_usd: held.tvl_usd, change_7d: held.change_7d, age_days: held.age_days, category: held.category };
      errs.push(Math.abs(Math.log(held.mcap_usd) - predictLog(row, fit, adj, c)));
    }
    var within = errs.filter(function (e) { return e <= Math.log(2); }).length;
    return {
      n: comps.length,
      median_factor: round4(Math.exp(median(errs))),
      p80_factor: round4(Math.exp(percentile(errs, 0.8))),
      within_2x: comps.length > 0 ? round4(within / comps.length) : 0,
    };
  }

  /** The cohort holdout: dated comps split at their median listing date, fit
   * on the earlier half, tested on the later, on current values throughout —
   * a holdout by cohort, not a historical forecast. The flat multiple beside
   * it carries no adjustments, so the gap is the full model's. */
  function timeSplitValidate(comps, c) {
    var dated = comps.filter(function (p) { return p.listed_at !== null && p.listed_at !== undefined; })
      .slice().sort(function (a, b) { return a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : a.slug < b.slug ? -1 : 1; });
    var half = Math.floor(dated.length / 2);
    var train = dated.slice(0, half), test = dated.slice(half);
    if (train.length < 5 || test.length < 5) return { train: train.length, test: test.length, median_factor: 0, flat_factor: 0 };
    var fit = fitCurve(train);
    var adj = categoryAdjustments(train, fit, c.shrink_k);
    var flat = median(train.map(function (p) { return Math.log(p.mcap_usd / p.tvl_usd); }));
    var errs = [], flatErrs = [];
    test.forEach(function (held) {
      var row = { tvl_usd: held.tvl_usd, change_7d: held.change_7d, age_days: held.age_days, category: held.category };
      errs.push(Math.abs(Math.log(held.mcap_usd) - predictLog(row, fit, adj, c)));
      flatErrs.push(Math.abs(Math.log(held.mcap_usd) - (Math.log(held.tvl_usd) + flat)));
    });
    return { train: train.length, test: test.length, median_factor: round4(Math.exp(median(errs))), flat_factor: round4(Math.exp(median(flatErrs))) };
  }

  /** The stability check: the curve refitted on fixed-seed bootstrap
   * resamples of the comps, reporting the slope's 10th/50th/90th percentiles. */
  function bootstrapSlope(comps, rounds, seed) {
    var state = seed >>> 0 || 1;
    function next() { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return state / 2147483648; }
    var slopes = [];
    for (var r = 0; r < rounds; r++) {
      var sample = [];
      for (var i = 0; i < comps.length; i++) sample.push(comps[Math.floor(next() * comps.length)]);
      slopes.push(fitCurve(sample).slope);
    }
    return { rounds: rounds, slope_p10: round4(percentile(slopes, 0.1)), slope_p50: round4(percentile(slopes, 0.5)), slope_p90: round4(percentile(slopes, 0.9)) };
  }

  var api = {
    ageDays: ageDays, median: median, fitCurve: fitCurve, categoryAdjustments: categoryAdjustments,
    impliedValue: impliedValue, looValidate: looValidate, timeSplitValidate: timeSplitValidate,
    bootstrapSlope: bootstrapSlope,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RadarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
