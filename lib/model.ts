// The token radar's core: the sealed snapshot in, the ranked board and the
// dashboard's data out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a
// ceiling) and every other rankable pre-token protocol the watchlist leaves
// out, whatever its size: the early rows the radar exists to find. A protocol is pre-token when its record carries no
// token at all (no market cap, no CoinGecko id, no symbol), and rankable only
// when it is not a wrapped, staked or bridged product of a token that already
// trades, by the same rule the house used to draw the watchlist. The protocols
// whose token already trades are kept apart: they calibrate the model as
// comps, and the dashboard shows the largest of them with the market's own
// values, never mixed into the ranking.
//
// The value model itself lives in dashboard/model.js, shared with the page, so
// the number board.json carries and the number the page recomputes are the
// same arithmetic; the farm plans live in dashboard/plan.js the same way.
// What this file adds is the snapshot's parsing, the comps set, the curve fit
// and its blind tests run at run time, the board's assembly, the audit of the
// pre-token universe, and the gate's own checks run before anything is written.

import modelJs from '../dashboard/model.js';
import planJs from '../dashboard/plan.js';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One traded protocol the curve is fitted on: the figures the fit and its tests read. */
export interface CompRow {
  slug: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
}

/** The value model's constants, as the dashboard states them. */
export interface ModelConstants {
  curve_intercept: number;
  curve_slope: number;
  category: Record<string, number>;
  shrink_k: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  band_factor: number;
}

/** The blind tests' results, for the model panel. */
export interface Validation {
  loo_n: number;
  loo_median_factor: number;
  loo_p80_factor: number;
  loo_within_2x: number;
  split_train: number;
  split_test: number;
  split_median_factor: number;
  split_flat_factor: number;
  boot_rounds: number;
  boot_slope_p10: number;
  boot_slope_p50: number;
  boot_slope_p90: number;
}

/** How the constants were calibrated from this snapshot, for the model panel. */
export interface Calibration {
  comps: number;
  median_age_days: number;
  known_age_protocols: number;
  validation: Validation;
}

/** The audit of the pre-token universe: what was ranked and what was set aside, and why. */
export interface Audit {
  protocols: number;
  pre_token: number;
  live_token: number;
  ranked: number;
  set_aside: number;
  set_aside_category: number;
  set_aside_versioned: number;
  set_aside_name: number;
  set_aside_exchange: number;
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** The growth and maturity weights: fixed, stated, and the same for every row. */
const GROWTH_WEIGHT = 0.5;
const GROWTH_FLOOR = -60;
const GROWTH_CAP = 120;
const MATURITY_FLOOR = 0.6;
const MATURITY_RANGE = 0.4;
const MATURITY_DAYS = 1095;
/** The category yardstick's shrinkage: a category's pull is n/(n+k). */
const SHRINK_K = 10;
/** Bootstrap rounds for the slope stability check (fixed seed: deterministic). */
const BOOT_ROUNDS = 200;
const BOOT_SEED = 20261114;

/** How many live-token protocols the dashboard's Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token' | 'live-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  low_usd: number;
  high_usd: number;
  verdict: string;
  plan_cost_usd: number;
  model: {
    curve_usd: number;
    category_multiplier: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the page generates its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  low_usd: number;
  high_usd: number;
  verdict: string;
  plan_cost_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the model it runs, and the audit. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  calibration: Calibration;
  audit: Audit;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The median of a sorted list of numbers; the mean of the two middles when even. */
export function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The house's wrapped-product rule, applied to the whole board: the categories
 * that are products of another protocol's token, a name carrying a whole word
 * wrapped, staked or staking, and a name beginning with an exchange's name.
 * WBTC is Bitcoin on Ethereum, Binance staked ETH is ETH in Binance's staking
 * product, and neither is a protocol still waiting on a launch of its own, so
 * the board never ranks them as one. The watchlist itself was drawn with this
 * rule (plus DefiLlama's parent-protocol record, which the snapshot does not
 * carry); the board keeps every watchlist slug regardless, and holds every
 * other protocol to the same rule.
 */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a protocol is set aside, in the rule's own order, or null when it is rankable. */
export function setAsideReason(p: SnapshotProtocol): 'category' | 'versioned' | 'name' | 'exchange' | null {
  if (WRAPPED_CATEGORIES.has(p.category ?? '')) return 'category';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (WRAPPED_WORD.test(p.name)) return 'name';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token, not a wrapped or staked product, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && setAsideReason(p) === null;
}

/**
 * The comps: the protocols whose token already trades and that resemble the
 * ranked set — no CEX, no wrapped/staked/bridged category, no versioned pool
 * — with a market cap and a TVL to fit on. The curve is fitted on these alone.
 */
export function compsOf(snapshot: Snapshot): CompRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && setAsideReason(p) === null && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({
      slug: p.slug,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      age_days: modelJs.ageDays(snapshot.as_of, p.listed_at),
      listed_at: p.listed_at,
    }));
}

/**
 * Calibrate the model's constants from the snapshot itself: fit the comps
 * curve, shrink the category yardsticks, run the blind tests, and take the
 * band from the leave-one-out median miss. The unknown-age fallback is the
 * median age of the protocols with a listing date. Everything is computed
 * here, at run time, from the sealed input, and shipped to the dashboard in
 * data.js. With too few comps to fit, the curve falls back to a flat 0.25
 * multiple and a x3 band, stated in the code rather than hidden.
 */
export function calibrate(snapshot: Snapshot): { constants: ModelConstants; calibration: Calibration } {
  const comps = compsOf(snapshot);
  const ages = snapshot.protocols
    .map((p) => modelJs.ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  const medianAge = ages.length > 0 ? Math.round(median(ages)) : 365;
  const tilt = {
    growth_weight: GROWTH_WEIGHT,
    growth_floor: GROWTH_FLOOR,
    growth_cap: GROWTH_CAP,
    maturity_floor: MATURITY_FLOOR,
    maturity_range: MATURITY_RANGE,
    maturity_days: MATURITY_DAYS,
    unknown_age_days: medianAge,
    shrink_k: SHRINK_K,
  };
  if (comps.length < 10) {
    const fallback: Validation = {
      loo_n: comps.length, loo_median_factor: 3, loo_p80_factor: 3, loo_within_2x: 0,
      split_train: 0, split_test: 0, split_median_factor: 0, split_flat_factor: 0,
      boot_rounds: 0, boot_slope_p10: 1, boot_slope_p50: 1, boot_slope_p90: 1,
    };
    return {
      constants: { curve_intercept: Math.log(0.25), curve_slope: 1, category: {}, ...tilt, band_factor: 3 },
      calibration: { comps: comps.length, median_age_days: medianAge, known_age_protocols: ages.length, validation: fallback },
    };
  }
  const fit = modelJs.fitCurve(comps);
  const adjustments = modelJs.categoryAdjustments(comps, fit, SHRINK_K);
  const loo = modelJs.looValidate(comps, tilt);
  const split = modelJs.timeSplitValidate(comps, tilt);
  const boot = modelJs.bootstrapSlope(comps, BOOT_ROUNDS, BOOT_SEED);
  const validation: Validation = {
    loo_n: loo.n,
    loo_median_factor: loo.median_factor,
    loo_p80_factor: loo.p80_factor,
    loo_within_2x: loo.within_2x,
    split_train: split.train,
    split_test: split.test,
    split_median_factor: split.median_factor,
    split_flat_factor: split.flat_factor,
    boot_rounds: boot.rounds,
    boot_slope_p10: boot.slope_p10,
    boot_slope_p50: boot.slope_p50,
    boot_slope_p90: boot.slope_p90,
  };
  return {
    constants: {
      curve_intercept: fit.intercept,
      curve_slope: fit.slope,
      category: adjustments,
      ...tilt,
      band_factor: loo.median_factor > 1 ? loo.median_factor : 1,
    },
    calibration: { comps: comps.length, median_age_days: medianAge, known_age_protocols: ages.length, validation },
  };
}

/** The audit of the pre-token universe, from the snapshot and the board. */
export function auditOf(snapshot: Snapshot, board: BoardRow[]): Audit {
  const ranked = new Set(board.map((r) => r.slug));
  const audit: Audit = {
    protocols: snapshot.protocols.length,
    pre_token: 0,
    live_token: 0,
    ranked: board.length,
    set_aside: 0,
    set_aside_category: 0,
    set_aside_versioned: 0,
    set_aside_name: 0,
    set_aside_exchange: 0,
  };
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) { audit.live_token++; continue; }
    audit.pre_token++;
    if (ranked.has(p.slug)) continue;
    audit.set_aside++;
    const reason = setAsideReason(p);
    if (reason === 'category') audit.set_aside_category++;
    else if (reason === 'versioned') audit.set_aside_versioned++;
    else if (reason === 'name') audit.set_aside_name++;
    else if (reason === 'exchange') audit.set_aside_exchange++;
  }
  return audit;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, constants: ModelConstants): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watchlist.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const age = modelJs.ageDays(snapshot.as_of, p.listed_at);
    const scored = modelJs.impliedValue({ tvl_usd: p.tvl_usd, change_7d: p.change_7d, age_days: age, category: p.category }, constants);
    const econ = planJs.planEconomics(
      { name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, age_days: age },
      scored.low_usd,
    );
    return { p, age, scored, econ };
  });
  scored.sort((a, b) => b.scored.implied_value_usd - a.scored.implied_value_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: isPreToken(s.p) ? 'pre-token' : 'live-token',
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.scored.implied_value_usd,
    low_usd: s.scored.low_usd,
    high_usd: s.scored.high_usd,
    verdict: s.econ.verdict,
    plan_cost_usd: s.econ.gas_usd,
    model: {
      curve_usd: s.scored.curve_usd,
      category_multiplier: s.scored.category_multiplier,
      growth_pct: s.scored.growth_pct,
      growth_multiplier: s.scored.growth_multiplier,
      maturity_multiplier: s.scored.maturity_multiplier,
      age_days: s.age,
    },
    farm_steps: planJs.buildFarmSteps({
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      age_days: s.age,
      low_usd: s.scored.low_usd,
    }),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { constants, calibration } = calibrate(snapshot);
  const board = buildBoard(snapshot, constants);
  const live = liveRows(snapshot);
  const audit = auditOf(snapshot, board);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: constants,
    calibration,
    audit,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      mcap_usd: row.mcap_usd,
      listed_at: row.listed_at,
      on_watchlist: row.on_watchlist,
      age_days: row.age_days,
      implied_value_usd: row.implied_value_usd,
      low_usd: row.low_usd,
      high_usd: row.high_usd,
      verdict: row.verdict,
      plan_cost_usd: row.plan_cost_usd,
      growth_multiplier: row.model.growth_multiplier,
      maturity_multiplier: row.model.maturity_multiplier,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  const asOf = new Date(`${o.as_of}T00:00:00Z`);
  if (!Number.isFinite(asOf.getTime()) || asOf.toISOString().slice(0, 10) !== o.as_of) throw new SnapshotError('snapshot.json has an as_of date that is not a real date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a positive TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' && p.gecko_id !== '' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' && p.symbol !== '' ? p.symbol : null,
    };
  });
  const seen = new Set<string>();
  for (const p of protocols) {
    if (seen.has(p.slug)) throw new SnapshotError(`snapshot.json repeats the slug ${p.slug}`);
    seen.add(p.slug);
  }
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice`;
    slugs.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than the 100 it must`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
