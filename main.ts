// A token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input
// <file|dir>, or $MAKEFUN_INPUT_DIR), fits every term of the value model from
// the snapshot's own live-token protocols by median regression, scores every
// rankable pre-token protocol, writes the ranked board to /output/board.json,
// writes the dashboard's data as data.js beside the page, copies this
// repository's dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library. The board is checked against the gate's own shape before
// anything is written, and the program is deterministic: two runs on the same
// snapshot write the same bytes.
//
// The dashboard is a static page, no framework and no network: dashboard/
// index.html, app.css, app.js, model.js and plan.js read data.js, which this
// program writes from the same board. The value model and the farm-plan
// generator live in dashboard/model.js and dashboard/plan.js and are shared
// with the page, so the board, the screenshots and the code can never disagree.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier's bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. A flag left bare is an error, never a silent fallback. */
/** Format a fitted coefficient with its sign, so a negative one reads "\u2212 0.2789" and never "+ -0.2789". */
function coef(x: number): string {
  return (x < 0 ? '\u2212 ' : '+ ') + Math.abs(x).toFixed(4);
}

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 >= process.argv.length) {
    process.stderr.write(`token radar: --${name} needs a value\n`);
    process.exit(2);
  }
  if (at >= 0) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', process.env.MAKEFUN_INPUT_DIR ?? '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

/** Parse, score and gate the snapshot, or fail with one line on stderr: no stack traces for bad input. */
function buildSnapshot(inputFile: string) {
  try {
    const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
    const { board, radar } = buildRadar(snapshot);
    const issue = boardIssue(board, snapshot);
    if (issue !== null) throw new Error(`the model wrote a board the gate refuses: ${issue}`);
    return { snapshot, board, radar };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`token radar: ${message.split('\n')[0]}\n`);
    process.exit(1);
  }
}

const { snapshot, board, radar } = buildSnapshot(inputFile);

/** One directory's regular files, skipping names that start with a dot. */
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .filter((name) => !name.startsWith('.') && statSync(join(dir, name)).isFile());
}

// The sources are checked before anything is written, so a bad dashboard or
// a missing screenshot leaves no partial /output behind.
const dashboardSource = sourceFiles(join(here, 'dashboard'));
if (!dashboardSource.includes('index.html')) {
  process.stderr.write('token radar: dashboard/ holds no index.html: the page is what the judge reads\n');
  process.exit(1);
}
const shotSource = sourceFiles(join(here, 'screenshots'));
if (shotSource.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shotSource.length} image${shotSource.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shotSource) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

mkdirSync(out, { recursive: true });
// Clear what this program owns, so a re-run leaves no stale file behind.
for (const name of ['board.json', 'data.js', 'dossier.json', 'dashboard', 'screenshots']) {
  rmSync(join(out, name), { recursive: true, force: true });
}
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
let dossier: string;
try {
  dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`token radar: ${message.split('\n')[0]}\n`);
  process.exit(1);
}
writeFileSync(join(out, 'dossier.json'), dossier);

// The summary names the fallback honestly: with too few comps no fit runs
// and no blind test runs, so the lines must not claim refits.
const validation = radar.calibration.validation;
const beta = radar.model.beta;
const fitted = radar.calibration.comps >= 10;
const modelSummary = fitted
  ? `model ln(mcap) = ${beta[0]!.toFixed(4)} ${coef(beta[1]!)} ln(TVL) ${coef(beta[2]!)} growth ${coef(beta[3]!)} ln(1+age) + category, fitted on ${radar.calibration.comps} traded comps by median regression; band x${radar.model.band_factor} from leave-one-out (median miss, ${validation.loo_n} refits)`
  : `model not fitted: ${radar.calibration.comps} traded comps is too few, so a stated 0.25 multiple and a x${radar.model.band_factor} band stand in, untested`;
const wfSummary = fitted && validation.wf_folds.length > 0
  ? `walk-forward: ${validation.wf_folds.map((f) => `train ${f.train}/test ${f.test} x${f.median_factor}`).join(', ')}`
  : 'walk-forward: not run';
const holdSummary = fitted
  ? `random holdouts (seeds ${validation.hold_seeds.join(', ')}): model x${validation.hold_median_factor} vs flat multiple x${validation.hold_flat_factor} (median of ${validation.hold_runs.length} 70/30 splits)`
  : 'random holdouts: not run';
const odds = radar.calibration.odds;
const oddsMin = Math.min(...odds.cells.map((c) => c.odds));
const oddsMax = Math.max(...odds.cells.map((c) => c.odds));
const oddsSummary = `launch odds: ${Math.round(odds.global_rate * 100)}% of protocols record a token; by age/TVL cohort ${Math.round(oddsMin * 100)}–${Math.round(oddsMax * 100)}%`;

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live shown, ${radar.set_aside.length} set aside listed)\n` +
    `token radar: ${modelSummary}\n` +
    `token radar: ${wfSummary}\n` +
    `token radar: ${holdSummary}\n` +
    `token radar: ${oddsSummary}\n` +
    `token radar: audit: ${radar.audit.pre_token} record no token, ${radar.audit.set_aside} set aside (${radar.audit.set_aside_category} category, ${radar.audit.set_aside_versioned} versioned, ${radar.audit.set_aside_name} name, ${radar.audit.set_aside_exchange} exchange); integrity: ${radar.integrity.unknown_age_rows} unknown-age, ${radar.integrity.thin_category_rows} thin-category, ${radar.integrity.missing_growth_rows} no-growth rows\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
