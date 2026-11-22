// radar-4 value model, shared by main.ts and the dashboard page. Every
// number is fitted from the snapshot's traded comps at run time — no tilt
// is hand-set: ln(mcap) = b0 + b1 ln(tvl) + b2 growth + b3 ln(1+age) +
// category. Median (LAD) regression by IRLS, growth winsorized, unknown
// age takes the comps' median age, category effects shrunk by leave-one-
// out. The band is the leave-one-out median miss; walk-forward and five
// seeded holdouts run beside it. Launch odds are empirical, by age/TVL
// cohort. Classic script: sets window.RadarModel. Required from Node:
// exports the same object. No imports, no network; fixed seeds.

(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var LAD_ROUNDS = 10;
  var LAD_FLOOR = 0.05;
  var SHRINK_GRID = [5, 10, 20, 40];

  /** Whole days from listedAt to asOf; null when a date is absent or bad. */
  function ageDays(asOf, listedAt) {
    if (listedAt === null || listedAt === undefined) return null;
    var a = Date.parse(asOf + 'T00:00:00Z');
    var b = Date.parse(listedAt + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.max(0, Math.floor((a - b) / DAY_MS));
  }

  function clamp(value, lo, hi) { return Math.min(hi, Math.max(lo, value)); }
  function round4(n) { return Math.round(n * 1e4) / 1e4; }

  /** The median; the list is left untouched. */
  function median(values) {
    if (values.length === 0) return 0;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /** A nearest-rank percentile; p in [0, 1]. */
  function percentile(values, p) {
    if (values.length === 0) return 0;
    var s = values.slice().sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  }

  /** Solve A x = b by Gaussian elimination with partial pivoting; null when singular. */
  function solve(A, b) {
    var n = b.length, i, j, r;
    var X = A.map(function (row, k) { return row.concat([b[k]]); });
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (r = col + 1; r < n; r++) if (Math.abs(X[r][col]) > Math.abs(X[piv][col])) piv = r;
      var tmp = X[col]; X[col] = X[piv]; X[piv] = tmp;
      var d = X[col][col];
      if (Math.abs(d) < 1e-12) return null;
      for (r = 0; r < n; r++) {
        if (r === col) continue;
        var f = X[r][col] / d;
        for (j = col; j <= n; j++) X[r][j] -= f * X[col][j];
      }
    }
    return X.map(function (row, k) { return row[n] / row[k]; });
  }

  /** Weighted least squares through the normal equations, with a whisper of ridge. */
  function wls(X, y, w) {
    var k = X[0].length, a, c, i;
    var A = [], b = [];
    for (a = 0; a < k; a++) { A.push([]); for (c = 0; c < k; c++) A[a].push(0); b.push(0); }
    for (i = 0; i < X.length; i++) {
      var wi = w ? w[i] : 1;
      for (a = 0; a < k; a++) {
        b[a] += wi * X[i][a] * y[i];
        for (c = 0; c < k; c++) A[a][c] += wi * X[i][a] * X[i][c];
      }
    }
    for (a = 0; a < k; a++) A[a][a] += 1e-8;
    return solve(A, b);
  }

  /** The train set's own winsor bounds and median age. */
  function bounds(train) {
    var gs = train.map(function (c) { return typeof c.change_7d === 'number' && isFinite(c.change_7d) ? c.change_7d : 0; });
    var ages = train.map(function (c) { return c.age_days; }).filter(function (a) { return typeof a === 'number'; });
    return { glo: percentile(gs, 0.025), ghi: percentile(gs, 0.975), medAge: ages.length ? median(ages) : 365 };
  }

  /** One comp's regressors under bounds B: [1, ln TVL, winsorized growth / 100, ln(1 + age)]. */
  function features(c, B) {
    var g = clamp(typeof c.change_7d === 'number' && isFinite(c.change_7d) ? c.change_7d : 0, B.glo, B.ghi) / 100;
    var age = typeof c.age_days === 'number' && isFinite(c.age_days) ? c.age_days : B.medAge;
    return [1, Math.log(Math.max(1, c.tvl_usd)), g, Math.log(1 + Math.max(0, age))];
  }

  /** Median regression of ln(mcap) on the features, by IRLS (weights 1/|residual|, floored). */
  function fitLAD(train, B) {
    var X = train.map(function (c) { return features(c, B); });
    var y = train.map(function (c) { return Math.log(c.mcap_usd); });
    var beta = wls(X, y, null);
    if (!beta) return null;
    for (var it = 0; it < LAD_ROUNDS; it++) {
      var w = X.map(function (x, i) {
        var r = y[i] - x.reduce(function (s, v, j) { return s + v * beta[j]; }, 0);
        return 1 / Math.max(Math.abs(r), LAD_FLOOR);
      });
      var next = wls(X, y, w);
      if (!next) break;
      beta = next;
    }
    return beta;
  }

  /** Each category's effect: its shrunken median residual, n/(n+k). Null-prototype accumulators, so `__proto__` is a key like any other. */
  function catFx(train, beta, B, k) {
    var byCat = Object.create(null);
    train.forEach(function (c) {
      var x = features(c, B);
      var pred = x.reduce(function (s, v, j) { return s + v * beta[j]; }, 0);
      var cat = c.category || 'Other';
      (byCat[cat] = byCat[cat] || []).push(Math.log(c.mcap_usd) - pred);
    });
    var out = Object.create(null);
    Object.keys(byCat).forEach(function (cat) {
      var list = byCat[cat];
      out[cat] = (list.length / (list.length + k)) * median(list);
    });
    return out;
  }

  /** A category's effect, or 0; the own-property check defeats prototype names. */
  function adjOf(fx, cat) {
    return Object.prototype.hasOwnProperty.call(fx, cat) ? fx[cat] : 0;
  }

  /** The log of the predicted value for one row under a fitted model. */
  function predictLog(row, m) {
    var x = features({ tvl_usd: row.tvl_usd, change_7d: row.change_7d, age_days: row.age_days }, m);
    return x.reduce(function (s, v, j) { return s + v * m.beta[j]; }, 0) + adjOf(m.cat, row.category || 'Other');
  }

  /** Fit one model on a train set at a fixed k, or null. */
  function fitAt(train, k) {
    var B = bounds(train);
    var beta = fitLAD(train, B);
    if (!beta) return null;
    return { beta: beta, cat: catFx(train, beta, B, k), glo: B.glo, ghi: B.ghi, medAge: B.medAge };
  }

  /** The shrinkage k whose leave-one-out median miss is smallest; ties go to the smaller k. */
  function selectK(comps) {
    var best = SHRINK_GRID[0], bestErr = Infinity;
    SHRINK_GRID.forEach(function (k) {
      var e = looValidate(comps, k).median_factor;
      if (e < bestErr - 1e-12) { bestErr = e; best = k; }
    });
    return best;
  }

  /** Fit the whole model on `comps`: bounds, median regression, shrinkage by leave-one-out, category effects. */
  function fitModel(comps, k) {
    var kk = typeof k === 'number' ? k : selectK(comps);
    var m = fitAt(comps, kk);
    if (!m) return null;
    m.k = kk;
    m.n = comps.length;
    return m;
  }

  /** The implied value under a fitted model `m` (which carries band_factor), with its band and every factor. */
  function impliedValue(row, m) {
    var g = clamp(typeof row.change_7d === 'number' && isFinite(row.change_7d) ? row.change_7d : 0, m.glo, m.ghi);
    var age = typeof row.age_days === 'number' && isFinite(row.age_days) ? row.age_days : m.medAge;
    var curveUsd = Math.exp(m.beta[0] + m.beta[1] * Math.log(Math.max(1, row.tvl_usd)));
    var catM = Math.exp(adjOf(m.cat, row.category || 'Other'));
    var growthF = Math.exp(m.beta[2] * (g / 100));
    var ageF = Math.exp(m.beta[3] * Math.log(1 + Math.max(0, age)));
    var implied = Math.max(1, Math.round(curveUsd * catM * growthF * ageF));
    var band = m.band_factor > 1 ? m.band_factor : 1;
    return {
      implied_value_usd: implied,
      low_usd: Math.max(1, Math.round(implied / band)),
      high_usd: Math.round(implied * band),
      curve_usd: Math.max(1, Math.round(curveUsd)),
      category_multiplier: round4(catM),
      growth_pct: round4(g),
      growth_factor: round4(growthF),
      age_factor: round4(ageF),
    };
  }

  /** The blind test: leave-one-out at the fitted k. Median miss (the band), 80th percentile, share inside x2. */
  function looValidate(comps, k) {
    var errs = [];
    for (var i = 0; i < comps.length; i++) {
      var m = fitAt(comps.slice(0, i).concat(comps.slice(i + 1)), k);
      if (!m) return { n: comps.length, median_factor: 0, p80_factor: 0, within_2x: 0 };
      errs.push(Math.abs(Math.log(comps[i].mcap_usd) - predictLog(comps[i], m)));
    }
    var within = errs.filter(function (e) { return e <= Math.log(2); }).length;
    return {
      n: comps.length,
      median_factor: round4(Math.exp(median(errs))),
      p80_factor: round4(Math.exp(percentile(errs, 0.8))),
      within_2x: comps.length > 0 ? round4(within / comps.length) : 0,
    };
  }

  /** Walk-forward: dated comps in listing order, four expanding windows (train 40/55/70/85%, test the next 15%). */
  function walkForward(comps) {
    var dated = comps.filter(function (p) { return p.listed_at !== null && p.listed_at !== undefined; })
      .slice().sort(function (a, b) { return a.listed_at.localeCompare(b.listed_at) || (a.slug < b.slug ? -1 : 1); });
    var folds = [];
    [0.4, 0.55, 0.7, 0.85].forEach(function (f) {
      var cut = Math.floor(dated.length * f);
      var train = dated.slice(0, cut);
      var test = dated.slice(cut, Math.min(dated.length, cut + Math.floor(dated.length * 0.15)));
      if (train.length < 5 || test.length < 5) return;
      var m = fitModel(train);
      if (!m) return;
      var errs = test.map(function (held) { return Math.abs(Math.log(held.mcap_usd) - predictLog(held, m)); });
      folds.push({ train: train.length, test: test.length, median_factor: round4(Math.exp(median(errs))) });
    });
    return { folds: folds };
  }

  /** The second holdout: a seeded random 70/30 split, the model against a flat multiple on the same train. */
  function randomHoldout(comps, seed) {
    var state = (seed >>> 0) || 1;
    function next() { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return state / 2147483648; }
    var idx = comps.map(function (_, i) { return i; });
    for (var i = idx.length - 1; i > 0; i--) { var j = Math.floor(next() * (i + 1)); var t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    var cut = Math.floor(comps.length * 0.7);
    var train = idx.slice(0, cut).map(function (k) { return comps[k]; });
    var test = idx.slice(cut).map(function (k) { return comps[k]; });
    if (train.length < 5 || test.length < 5) return { train: train.length, test: test.length, median_factor: 0, flat_factor: 0 };
    var m = fitModel(train);
    if (!m) return { train: train.length, test: test.length, median_factor: 0, flat_factor: 0 };
    var flat = median(train.map(function (p) { return Math.log(p.mcap_usd / p.tvl_usd); }));
    var errs = [], flatErrs = [];
    test.forEach(function (held) {
      errs.push(Math.abs(Math.log(held.mcap_usd) - predictLog(held, m)));
      flatErrs.push(Math.abs(Math.log(held.mcap_usd) - (Math.log(held.tvl_usd) + flat)));
    });
    return { train: train.length, test: test.length, median_factor: round4(Math.exp(median(errs))), flat_factor: round4(Math.exp(median(flatErrs))) };
  }

  /** A value's band under tertile cuts; null sits in the middle band. */
  function bandOf(v, cuts) { return v === null || v === undefined ? 1 : v < cuts[0] ? 0 : v < cuts[1] ? 1 : 2; }

  /** Launch odds from the peers' own record: age tertile x TVL tertile, each cell shrunk toward the global rate with a +2 pseudo-count. */
  function oddsTable(protocols, asOf) {
    var tokened = function (p) { return !(p.mcap_usd === null && p.gecko_id === null && p.symbol === null); };
    var global = protocols.length ? protocols.filter(tokened).length / protocols.length : 0;
    var tvls = protocols.map(function (p) { return p.tvl_usd; });
    var ages = protocols.map(function (p) { return ageDays(asOf, p.listed_at); }).filter(function (a) { return a !== null; });
    var tvlCuts = [percentile(tvls, 1 / 3), percentile(tvls, 2 / 3)];
    var ageCuts = ages.length ? [percentile(ages, 1 / 3), percentile(ages, 2 / 3)] : [0, 0];
    var counts = [];
    for (var i = 0; i < 9; i++) counts.push({ n: 0, tok: 0 });
    protocols.forEach(function (p) {
      var c = counts[bandOf(ageDays(asOf, p.listed_at), ageCuts) * 3 + bandOf(p.tvl_usd, tvlCuts)];
      c.n++;
      if (tokened(p)) c.tok++;
    });
    var cells = counts.map(function (c, i) {
      return { age: Math.floor(i / 3), tvl: i % 3, n: c.n, tokened: c.tok, odds: c.n > 0 ? round4((c.tok + 2 * global) / (c.n + 2)) : round4(global) };
    });
    return { global_rate: round4(global), age_cuts: ageCuts, tvl_cuts: tvlCuts, cells: cells };
  }

  /** One protocol's launch odds from a table: its age/TVL cell. */
  function oddsFor(table, ageDaysValue, tvlUsd) {
    var cell = table.cells[bandOf(ageDaysValue, table.age_cuts) * 3 + bandOf(tvlUsd, table.tvl_cuts)];
    return cell ? cell.odds : table.global_rate;
  }

  /** The second holdout, repeated: one seeded 70/30 split is noisy at n=28,
   * so five fixed seeds run and the medians are reported — the bad seed
   * included, not hidden. */
  function repeatedHoldout(comps, seeds) {
    var runs = seeds.map(function (seed) {
      var r = randomHoldout(comps, seed);
      return { seed: seed, train: r.train, test: r.test, median_factor: r.median_factor, flat_factor: r.flat_factor };
    });
    return {
      seeds: seeds,
      runs: runs,
      median_factor: round4(median(runs.map(function (r) { return r.median_factor; }))),
      flat_factor: round4(median(runs.map(function (r) { return r.flat_factor; }))),
    };
  }

  var api = {
    ageDays: ageDays,
    fitModel: fitModel, impliedValue: impliedValue,
    looValidate: looValidate, walkForward: walkForward, repeatedHoldout: repeatedHoldout,
    oddsTable: oddsTable, oddsFor: oddsFor,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RadarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
