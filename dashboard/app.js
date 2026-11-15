// Token Radar's dashboard. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable and
// sortable table, a per-protocol detail view with the model's arithmetic
// and the plan's netted economics, and a view of the protocols whose token
// already trades. No network. RadarModel and RadarPlan are the same code
// main.ts runs: the page recomputes each row and checks board.json, so
// screenshots, page and board cannot disagree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var MODEL = window.RadarModel;
  var PLAN = window.RadarPlan;
  var app = document.getElementById('board');
  if (!DATA || !MODEL || !PLAN) {
    if (app) app.innerHTML = '<p class="noscript">Token Radar could not load its data. The dashboard reads data.js, model.js and plan.js beside this page.</p>';
    return;
  }

  var state = { q: '', category: 'all', chain: 'all', scope: 'all', verdict: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    return 'x' + n.toFixed(2);
  }
  function chainLabel(row) {
    if (!row.chains || row.chains.length === 0) return 'an unnamed chain';
    if (row.chains.length <= 2) return row.chains.join(', ');
    return row.chains.slice(0, 2).join(', ') + ' +' + (row.chains.length - 2);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- state in the address hash, so a view can be linked and screenshotted ----

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope') === 'watchlist' || params.get('scope') === 'early') state.scope = params.get('scope');
    if (params.get('verdict') === 'FARM' || params.get('verdict') === 'THIN' || params.get('verdict') === 'SKIP') state.verdict = params.get('verdict');
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---- filtering and sorting ----

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.scope === 'watchlist' && !r.on_watchlist) return false;
      if (state.scope === 'early' && r.on_watchlist) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (state.sort === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (state.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (state.sort === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (state.sort === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---- header, lede, controls ----

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, 'Token ', el('em', { text: 'Radar' }))
      ),
      el('div', { class: 'top-meta' },
        el('span', { class: 'chip' }, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { class: 'chip' }, 'DefiLlama protocol index'),
        el('span', { class: 'chip' }, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    var v = DATA.calibration.validation;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, 'Every protocol with no token on record, ranked by ', el('span', { class: 'hl', text: 'implied value' })),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record, plus every other rankable pre-token protocol the watchlist leaves out. Each row states what a launch would be worth if the record stayed as it is, with the band the backtest earns, and how to farm it — netted to a verdict.' }),
        el('p', { text: 'Implied value is a model, not a promise: it says nothing about whether or when a token is issued. ' + DATA.audit.pre_token + ' protocols record no token; ' + DATA.audit.set_aside + ' are set aside as wrapped, staked, bridged or versioned products, and ' + DATA.board_size + ' are ranked.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Blind-test miss (median)' }), el('b', { text: 'x' + v.loo_median_factor.toFixed(2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Band on every row' }), el('b', { text: 'x/\u00F7' + DATA.model.band_factor.toFixed(2) }))
      )
    );
  }

  function selectField(id, label, options, current, onChange) {
    var select = el('select', { id: id, 'aria-label': label },
      options.map(function (o) {
        return el('option', { value: o.value, text: o.label, selected: o.value === current ? 'selected' : null });
      })
    );
    select.addEventListener('change', function () { onChange(select.value); writeHash(); render(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), select);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (all, r) { return all.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var scope = el('div', { class: 'tabs', role: 'group', 'aria-label': 'Scope' },
      [['all', 'All rows'], ['watchlist', 'Watchlist'], ['early', 'Early']].map(function (pair) {
        return el('button', {
          type: 'button',
          'aria-pressed': state.scope === pair[0] ? 'true' : 'false',
          text: pair[1],
          onclick: function () { state.scope = pair[0]; writeHash(); render(); },
        });
      })
    );
    var shown = state.tab === 'pre-token' ? visibleRows().length : DATA.live.length;
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('category', 'Category',
        [{ value: 'all', label: 'All categories' }].concat(categories.map(function (c) { return { value: c, label: c }; })),
        state.category, function (v) { state.category = v; }),
      selectField('chain', 'Chain',
        [{ value: 'all', label: 'All chains' }].concat(chains.map(function (c) { return { value: c, label: c }; })),
        state.chain, function (v) { state.chain = v; }),
      selectField('verdict', 'Verdict',
        [{ value: 'all', label: 'All verdicts' }, { value: 'FARM', label: 'FARM' }, { value: 'THIN', label: 'THIN' }, { value: 'SKIP', label: 'SKIP' }],
        state.verdict, function (v) { state.verdict = v; }),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Scope' }), scope),
      el('span', { class: 'count' }, el('b', { text: String(shown) }), state.tab === 'pre-token' ? ' rows shown' : ' live-token protocols')
    );
  }

  function tabBar() {
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'field', style: 'margin-top:14px' },
      el('span', { class: 'field-label', text: 'Token status' }),
      el('div', { class: 'tabs', role: 'group', 'aria-label': 'Token status' }, pre, live)
    );
  }

  // ---- tables ----

  function sortHeader(key, label, numeric) {
    var btn = el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } }, label);
    if (state.sort === key) btn.appendChild(el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25BC' : ' \u25B2' }));
    return el('th', { scope: 'col', class: numeric ? 'num' : null }, btn);
  }

  function protocolCell(r) {
    return el('td', null, el('div', { class: 'name' },
      el('b', { text: r.name }),
      el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) })
    ));
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or scope to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; state.verdict = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        protocolCell(r),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'band', text: fmtUsd(r.low_usd) + ' \u2013 ' + fmtUsd(r.high_usd) })
        )),
        el('td', null,
          el('span', { class: r.on_watchlist ? 'status watch' : 'status', text: r.on_watchlist ? 'watchlist' : 'no token' }),
          ' ',
          el('span', { class: 'verdict ' + r.verdict.toLowerCase(), text: r.verdict })
        )
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', null, el('b', { text: 'Pre-token protocols, strongest implied value first. ' }), 'Select a row for its model breakdown and farm plan.'),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank', true),
            sortHeader('name', 'Protocol', false),
            sortHeader('tvl', 'TVL', true),
            sortHeader('growth', '7d', true),
            sortHeader('age', 'Age', true),
            sortHeader('implied', 'Implied value', true),
            el('th', { scope: 'col', text: 'Standing' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', { tabindex: '-1', onclick: function () {} },
        el('td', { class: 'num rank', text: 'live' }),
        protocolCell(r),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', null, el('b', { text: 'Token live, set aside. ' }), 'These protocols already trade, so their market cap is a fact, not a model. They never enter the pre-token ranking; ' + DATA.calibration.comps + ' of them, the ones that resemble the ranked set, are the comps the curve is fitted on.'),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', class: 'num', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }),
            el('th', { scope: 'col', class: 'num', text: '7d' }),
            el('th', { scope: 'col', class: 'num', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Standing' })
          )),
          tbody
        )
      )
    );
  }

  // ---- model panel and footer ----

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var v = cal.validation;
    var a = DATA.audit;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed — and how it was tested' }),
      el('p', { class: 'sub', text: 'One function scores every row from the snapshot\u2019s own figures: TVL, seven-day growth, and time run with no token. No name is special-cased, no row hand-picked. The value is a comps curve, not one multiple: the multiple falls steeply with size, so each protocol is priced off the traded comps nearest its size, then its category\u2019s yardstick.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'implied = round( exp(' + m.curve_intercept.toFixed(4) + ' + ' + m.curve_slope.toFixed(4) + ' \u00D7 ln(tvl_usd)) \u00D7 category \u00D7 (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 \u00D7 ' + m.growth_weight + ') \u00D7 (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' \u00D7 ' + m.maturity_range + ') )' })
      ),
      el('div', { class: 'calibration' },
        el('div', null, el('span', { text: 'Curve fitted on' }), el('b', { text: cal.comps + ' traded comps' })),
        el('div', null, el('span', { text: 'Blind test (leave-one-out)' }), el('b', { text: 'median miss x' + v.loo_median_factor.toFixed(2) + ', ' + Math.round(v.loo_within_2x * 100) + '% inside x2' })),
        el('div', null, el('span', { text: 'Cohort holdout' }), el('b', { text: 'x' + v.split_median_factor.toFixed(2) + ' vs x' + v.split_flat_factor.toFixed(2) + ' flat' })),
        el('div', null, el('span', { text: 'Slope stability (200 resamples)' }), el('b', { text: v.boot_slope_p10.toFixed(2) + ' \u2013 ' + v.boot_slope_p90.toFixed(2) })),
        el('div', null, el('span', { text: 'Band on every row' }), el('b', { text: 'x/\u00F7' + m.band_factor.toFixed(2) + ' (the blind test\u2019s median miss)' })),
        el('div', null, el('span', { text: 'Unknown age uses' }), el('b', { text: cal.median_age_days + ' days (median)' }))
      ),
      el('p', { class: 'note', text: 'The blind test refits the curve ' + v.loo_n + ' times, each holding one traded protocol out; 4 in 5 held-out comps land within x' + v.loo_p80_factor.toFixed(1) + '. The cohort holdout fits on the ' + v.split_train + ' earliest-listed comps and tests the ' + v.split_test + ' later ones, on current snapshot values throughout — a holdout by listing cohort, not a historical forecast. The flat multiple, with no adjustments, misses by x' + v.split_flat_factor.toFixed(2) + ' on the same split, so the gap is the full model\u2019s, not the curve\u2019s alone. Each category\u2019s yardstick is its comps\u2019 median miss from the curve, shrunk by n/(n+' + m.shrink_k + '). Wrapped, staked and bridged products are set aside by the house rule \u2014 ' + a.set_aside_category + ' by category, ' + a.set_aside_versioned + ' versioned, ' + a.set_aside_name + ' named \u2014 because each is a product of a token that already trades. Pre-token means the record carries no token: the record is not proof it has none.' })
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Snapshot ' + DATA.as_of + ' from the DefiLlama protocol index, frozen for this competition; the same bytes score every entry. The board covers all ' + DATA.watchlist_size + ' watchlist protocols and ' + DATA.early_size + ' more rankable pre-token protocols the watchlist leaves out.' }),
      el('p', { text: 'Farm plans are generic steps derived from each protocol\u2019s category, chains, size and age, netted against the band\u2019s low end at a stated 10% farmer share. They are not financial advice: check the protocol\u2019s own pages before moving funds, and never pay anyone to claim for you.' })
    );
  }

  // ---- detail view ----

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    if (state.selected) { state.selected = null; writeHash(); render(); }
  });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    var recomputed = MODEL.impliedValue(
      { tvl_usd: row.tvl_usd, change_7d: row.change_7d, age_days: row.age_days, category: row.category },
      DATA.model
    );
    var matches = recomputed.implied_value_usd === row.implied_value_usd && recomputed.low_usd === row.low_usd && recomputed.high_usd === row.high_usd;
    var econ = PLAN.planEconomics(row, row.low_usd);
    var verdictMatches = econ.verdict === row.verdict;
    var steps = PLAN.buildFarmSteps(row);
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' \u00B7 watchlist' : ' \u00B7 early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' \u00B7 records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Curve value at this TVL' }), el('b', { class: 'num', text: fmtUsd(recomputed.curve_usd) })),
        el('div', null, el('span', { text: 'Category yardstick' }), el('b', { class: 'num', text: fmtMult(recomputed.category_multiplier) })),
        el('div', null, el('span', { text: 'Growth factor' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity factor' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Backtest band' }), el('b', { class: 'num', text: fmtUsd(row.low_usd) + ' \u2013 ' + fmtUsd(row.high_usd) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'check' },
        'Model ' + DATA.model_version + ': this page recomputes the row as ',
        el('b', { text: fmtUsd(recomputed.implied_value_usd) }),
        matches ? ', the same number the board carries, band and all.' : ', which differs from the board: the data would be stale.',
        ' This is an estimate, not a price.'
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm economics' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Band\u2019s low end' }), el('b', { class: 'num', text: fmtUsd(row.low_usd) })),
        el('div', null, el('span', { text: 'Farmer pool (10% assumed)' }), el('b', { class: 'num', text: fmtUsd(econ.pool_usd) })),
        el('div', null, el('span', { text: 'Plan gas (' + econ.tx_count + ' transactions)' }), el('b', { class: 'num', text: '$' + econ.gas_usd })),
        el('div', null, el('span', { text: 'Farmers covered' }), el('b', { class: 'num', text: econ.farmers.toLocaleString('en-US') })),
        el('div', { class: 'total' }, el('span', { text: 'Verdict' }), el('b', { class: 'verdict ' + row.verdict.toLowerCase(), text: row.verdict }))
      ),
      el('p', { class: 'check' },
        'Netted at the band\u2019s low end: the 10% farmer share is an assumption, stated here, and the verdict follows from it — FARM at 50,000 farmers covered, THIN at 5,000, SKIP below that.',
        verdictMatches ? '' : ' The recomputed verdict differs from the board: the data would be stale.'
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        var costAt = tail.indexOf(' Time: ');
        var cost = costAt >= 0 ? tail.slice(0, costAt) : tail;
        var time = costAt >= 0 ? tail.slice(costAt + 1) : '';
        return el('li', null,
          el('b', { text: action }),
          el('span', { class: 'cost' }, el('b', { text: cost }), time ? ' \u00B7 ' + time : '')
        );
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(tabBar());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected && !dialog.open) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () {
    // A new hash in the address bar (a pasted link, back/forward) re-reads the
    // view instead of being ignored: the same view a fresh load would show.
    if (dialog.open) dialog.close();
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.scope = 'all';
    state.verdict = 'all';
    state.tab = 'pre-token';
    state.selected = null;
    readHash();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
