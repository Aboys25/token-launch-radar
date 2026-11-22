// Token Radar's dashboard. Reads window.RADAR (written beside dashboard/
// by main.ts): the ranked board, per-protocol detail, live-token view, and
// the set-aside list. No network. RadarModel/RadarPlan are the same code
// main.ts runs, so the page recomputes the opened row and checks board.json.
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

  var state = { q: '', scope: 'all', verdict: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function fmtCoef(x) { return (x < 0 ? '\u2212 ' : '+ ') + Math.abs(x).toFixed(4); }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return PLAN.fmtUsd(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    return days >= 365 ? (days / 365).toFixed(1) + 'y' : Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    return 'x' + n.toFixed(2);
  }
  function fmtOdds(o) {
    if (o === null || o === undefined || !isFinite(o)) return 'n/a';
    return Math.round(o * 100) + '%';
  }
  function chainLabel(row) {
    var c = row.chains || [];
    if (c.length === 0) return 'an unnamed chain';
    return c.slice(0, 2).join(', ') + (c.length > 2 ? ' +' + (c.length - 2) : '');
  }

  /** Escape text for innerHTML: protocol names come from the snapshot, never trust them raw. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /** A plain table (no sorting, no clicks) from HTML strings; the board table stays DOM-built. */
  function plainTable(caption, headHtml, rowsHtml) {
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="panel"><div class="table-wrap"><table><caption>' + caption + '</caption><thead><tr>' + headHtml + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';
    return wrap.firstChild;
  }

  /** The model.js shape of the constants: the same numbers under the names the shared code reads. */
  function jsModel() {
    var m = DATA.model;
    return { beta: m.beta, cat: m.category, glo: m.growth_floor, ghi: m.growth_cap, medAge: m.unknown_age_days, band_factor: m.band_factor };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class' && attrs[k]) node.className = attrs[k];
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

  // state in the hash

  /** The hash keys and the values each accepts (null: any value). */
  var HASH_SPEC = [
    ['q', null],
    ['scope', ['watchlist', 'early']],
    ['verdict', ['FARM', 'THIN', 'SKIP']],
    ['tab', ['live', 'set-aside']],
    ['sort', ['implied', 'rank', 'name', 'tvl', 'growth', 'age', 'odds']],
  ];

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    HASH_SPEC.forEach(function (spec) {
      var v = params.get(spec[0]);
      if (v && (!spec[1] || spec[1].indexOf(v) >= 0)) state[spec[0]] = v;
    });
    if (params.get('dir') === '1' || params.get('dir') === '-1') state.dir = Number(params.get('dir'));
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    var defaults = { q: '', scope: 'all', verdict: 'all', tab: 'pre-token', sort: 'implied' };
    HASH_SPEC.forEach(function (spec) {
      if (state[spec[0]] !== defaults[spec[0]]) params.set(spec[0], state[spec[0]]);
    });
    if (state.dir !== -1) params.set('dir', state.dir);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // filtering and sorting

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.scope === 'watchlist' && !r.on_watchlist) return false;
      if (state.scope === 'early' && r.on_watchlist) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var nil = state.dir < 0 ? -Infinity : Infinity; // unknowns last either way
    function key(r) {
      if (state.sort === 'name') return r.name.toLowerCase();
      if (state.sort === 'tvl') return r.tvl_usd;
      if (state.sort === 'rank') return r.rank;
      if (state.sort === 'growth') return r.change_7d === null ? nil : r.change_7d;
      if (state.sort === 'age') return r.age_days === null ? nil : r.age_days;
      if (state.sort === 'odds') return r.launch_odds;
      return r.implied_value_usd;
    }
    return list.slice().sort(function (a, b) {
      var av = key(a), bv = key(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // header, lede, controls

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, 'Token ', el('em', { text: 'Radar' }))
      )
    );
  }

  function lede() {
    var covered = DATA.rows.filter(function (r) { return r.on_watchlist; }).length;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, 'Every protocol with no token on record, ranked by ', el('span', { class: 'hl', text: 'implied value' })),
        el('p', { text: 'The watchlist is the floor: ' + DATA.watchlist_size + ' on the house list, plus every other rankable pre-token protocol. Each row states what a launch would be worth, the band the backtest earns, the odds its peers launched, and how to farm it — netted to a verdict.' }),
        el('p', { text: 'Implied value is a model, not a promise: it says nothing about whether or when a token is issued.' })      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: covered + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) }))
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

  function tabGroup(idPrefix, label, options, current, onPick) {
    return el('div', { class: 'tabs', role: 'group', 'aria-label': label },
      options.map(function (pair) {
        return el('button', { type: 'button', id: idPrefix + '-' + pair[0], 'aria-pressed': current === pair[0] ? 'true' : 'false', text: pair[1], onclick: function () { onPick(pair[0]); writeHash(); render(); } });
      })
    );
  }

  function controls() {
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var scope = tabGroup('scope', 'Scope', [['all', 'All rows'], ['watchlist', 'Watchlist'], ['early', 'Early']], state.scope, function (v) { state.scope = v; });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('verdict', 'Verdict',
        [{ value: 'all', label: 'All verdicts' }, { value: 'FARM', label: 'FARM' }, { value: 'THIN', label: 'THIN' }, { value: 'SKIP', label: 'SKIP' }],
        state.verdict, function (v) { state.verdict = v; }),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Scope' }), scope)
    );
  }

  function tabBar() {
    return tabGroup('tab', 'Token status', [['pre-token', 'Pre-token board'], ['live', 'Live token'], ['set-aside', 'Set aside (' + DATA.set_aside.length + ')']], state.tab, function (v) { state.tab = v; });
  }

  // tables

  function sortHeader(key, label, numeric) {
    var btn = el('button', { type: 'button', id: 'sort-' + key, onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; } writeHash(); render(); } }, label);
    if (state.sort === key) btn.appendChild(el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25BC' : ' \u25B2' }));
    return el('th', { scope: 'col', class: numeric ? 'num' : null, 'aria-sort': state.sort === key ? (state.dir < 0 ? 'descending' : 'ascending') : null }, btn);
  }

  function protocolCell(r) {
    return el('td', null, el('div', { class: 'name' },
      el('b', { text: r.name }),
      el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) })
    ));
  }

  /** One labelled figure in an equation grid; `total` highlights the row. */
  function eqRow(label, value, total) {
    return el('div', { class: total ? 'total' : null }, el('span', { text: label }), el('b', { class: 'num', text: value }));
  }

  /** One labelled figure in the calibration grid. */
  function calRow(label, value) {
    return el('div', null, el('span', { text: label }), el('b', { text: value }));
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another verdict or scope.' })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        role: 'button',
        'aria-label': r.name + ', rank ' + r.rank + ', ' + r.verdict,
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        protocolCell(r),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtOdds(r.launch_odds) }),
        el('td', null, el('div', { class: 'implied' },
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
            sortHeader('rank', 'Rank', true),
            sortHeader('name', 'Protocol', false),
            sortHeader('tvl', 'TVL', true),
            sortHeader('growth', '7d', true),
            sortHeader('age', 'Age', true),
            sortHeader('odds', 'Launch odds', true),
            sortHeader('implied', 'Implied value', true),
            el('th', { scope: 'col', text: 'Standing' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var rows = DATA.live.map(function (r) {
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      return '<tr><td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc(chainLabel(r)) + '</span></div></td><td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num ' + gc + '">' + fmtPct(r.change_7d) + '</td><td class="num">' + fmtUsd(r.mcap_usd) + '</td></tr>';
    }).join('');
    return plainTable(
      '<b>Token live, set aside. </b>These protocols already trade, so their market cap is a fact, not a model. They never enter the ranking; ' + DATA.calibration.comps + ' of them are the comps the curve is fitted on.',
      '<th scope="col">Protocol</th><th scope="col" class="num">TVL</th><th scope="col" class="num">7d</th><th scope="col" class="num">Market cap</th>',
      rows
    );
  }

  function setAsideTable() {
    var rows = DATA.set_aside.map(function (r) {
      var reason = r.reason === 'category' ? 'wrapped/staked/bridged category' : r.reason === 'versioned' ? 'versioned pool' : r.reason === 'name' ? 'wrapped/staked name' : 'exchange prefix';
      return '<tr><td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + esc(chainLabel(r)) + '</span></div></td><td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num">' + fmtAge(r.age_days) + '</td><td><span class="status">' + reason + '</span></td></tr>';
    }).join('');
    return plainTable(
      '<b>Set aside, by the house rule. </b>Every one of the ' + DATA.audit.set_aside + ' pre-token protocols the board does not rank, listed by name: a wrapped, staked or bridged product of a token that already trades, a versioned pool, or an exchange prefix. The board accounts for all ' + DATA.audit.protocols + ' protocols.',
      '<th scope="col">Protocol</th><th scope="col" class="num">TVL</th><th scope="col" class="num">Age</th><th scope="col">Why set aside</th>',
      rows
    );
  }

  // model panel and footer

  function oddsGrid() {
    var o = DATA.calibration.odds;
    var ageNames = ['Young', 'Middle', 'Old'];
    function bandLabel(v, cuts, isAge) {
      if (v === 0) return '< ' + (isAge ? fmtAge(cuts[0]) : fmtUsd(cuts[0]));
      if (v === 1) return (isAge ? fmtAge(cuts[0]) : fmtUsd(cuts[0])) + ' \u2013 ' + (isAge ? fmtAge(cuts[1]) : fmtUsd(cuts[1]));
      return '\u2265 ' + (isAge ? fmtAge(cuts[1]) : fmtUsd(cuts[1]));
    }
    var head = '<th scope="col">Age \\ TVL</th>' + [0, 1, 2].map(function (ti) { return '<th scope="col" class="num">' + bandLabel(ti, o.tvl_cuts, false) + '</th>'; }).join('');
    var rows = [0, 1, 2].map(function (ai) {
      var cells = [0, 1, 2].map(function (ti) {
        var cell = o.cells[ai * 3 + ti];
        return '<td class="num"><b>' + fmtOdds(cell.odds) + '</b> <span class="sub">' + cell.tokened + '/' + cell.n + '</span></td>';
      }).join('');
      return '<tr><th scope="row">' + ageNames[ai] + ' (' + bandLabel(ai, o.age_cuts, true) + ')</th>' + cells + '</tr>';
    }).join('');
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="odds-wrap"><h3>Launch odds by cohort (age \u00D7 TVL)</h3><p class="sub">The share of protocols in each cohort that already record a token. A protocol takes the odds of its own cohort.</p><table class="odds-grid"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    return wrap.firstChild;
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var v = cal.validation;
    var g = DATA.integrity;
    var tested = v.loo_n >= 10;
    var wfText = v.wf_folds.length > 0
      ? v.wf_folds.map(function (f) { return 'train ' + f.train + '/test ' + f.test + ' x' + f.median_factor.toFixed(2); }).join(' \u00B7 ')
      : 'not measured';
    var holdText = tested
      ? 'x' + v.hold_median_factor.toFixed(2) + ' vs x' + v.hold_flat_factor.toFixed(2) + ' flat (median of ' + v.hold_runs.length + ' seeds)'
      : 'not measured (too few comps)';
    var b = m.beta;
    var testsText = tested
      ? 'The blind test refits the model ' + v.loo_n + ' times, each holding one traded protocol out; ' + Math.round(v.loo_within_2x * 100) + '% of held-out comps land within x2, and 4 in 5 within x' + v.loo_p80_factor.toFixed(1) + '. Walk-forward refits on the earliest-listed comps and scores the next slice, four times over. The random holdouts fit on 70% and test on 30% across five fixed seeds (median reported, the worst seed included); the flat multiple misses by x' + v.hold_flat_factor.toFixed(2) + ' on the same splits. '
      : 'Too few traded comps to fit or test the model, so a stated 0.25 multiple and a x' + m.band_factor.toFixed(2) + ' band stand in, untested. ';
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed — and how it was tested' }),
      el('p', { class: 'sub', text: 'One function scores every row from the snapshot\u2019s own figures: TVL, seven-day growth, and time run with no token. Every number in it is fitted from the traded comps by median regression — no tilt is hand-set.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'implied = round( exp(' + b[0].toFixed(4) + ' ' + fmtCoef(b[1]) + ' \u00D7 ln(tvl_usd) ' + fmtCoef(b[2]) + ' \u00D7 growth ' + fmtCoef(b[3]) + ' \u00D7 ln(1+age_days)) \u00D7 category )' })
      ),
      el('div', { class: 'calibration' },
        calRow('Fit', tested ? 'median regression on ' + cal.comps + ' traded comps' : 'fallback: 0.25 multiple'),
        calRow('Blind test (leave-one-out)', tested ? 'median miss x' + v.loo_median_factor.toFixed(2) + ', ' + Math.round(v.loo_within_2x * 100) + '% inside x2' : 'not measured (too few comps)'),
        calRow('Walk-forward (4 folds)', wfText),
        calRow('Random holdouts', holdText),
        calRow('Band on every row', 'x/\u00F7' + m.band_factor.toFixed(2) + (tested ? ' (the blind test\u2019s median miss)' : ' (fallback band, untested)')),
        calRow('Unknown age uses', cal.median_age_days + ' days (median)'),
        calRow('Integrity flags', g.unknown_age_rows + ' unknown-age \u00B7 ' + g.thin_category_rows + ' thin-category \u00B7 ' + g.missing_growth_rows + ' no-growth')
      ),
      el('p', { class: 'note', text: testsText + 'Each category\u2019s effect is its comps\u2019 median residual, shrunk by n/(n+' + m.shrink_k + '), the shrinkage chosen by leave-one-out. Growth is winsorized at the comps\u2019 2.5/97.5 percentiles (' + m.growth_floor.toFixed(1) + '% to ' + m.growth_cap.toFixed(1) + '%), and an unknown age takes the comps\u2019 median age.' }),
      oddsGrid()
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Snapshot ' + DATA.as_of + ' from the DefiLlama protocol index, frozen for this competition. Farm plans are steps derived from each protocol\u2019s category, chains, size, age, launch odds and verdict, netted at a stated 10% farmer share. Not financial advice: check the protocol\u2019s own pages before moving funds, and never pay anyone to claim for you.' })
    );
  }

  // detail view

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
      jsModel()
    );
    var matches = recomputed.implied_value_usd === row.implied_value_usd && recomputed.low_usd === row.low_usd && recomputed.high_usd === row.high_usd;
    var steps = PLAN.buildFarmSteps(row);
    var flagsText = row.flags && row.flags.length > 0 ? row.flags.join(', ') : 'none: age, growth and category all measured';
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' \u00B7 watchlist' : ' \u00B7 early radar') + ' \u00B7 ' + row.verdict }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.mcap_usd === null ? ' \u00B7 records no token' : ' \u00B7 token already trades') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        eqRow('TVL', fmtUsd(row.tvl_usd)),
        eqRow('Growth (7d)', row.change_7d === null ? 'n/a' : fmtPct(row.change_7d) + (recomputed.growth_pct !== row.change_7d ? ' \u2192 ' + fmtPct(recomputed.growth_pct) + ' clamped' : '')),
        eqRow('Age', fmtAge(row.age_days)),
        eqRow('Launch odds', fmtOdds(row.launch_odds)),
        eqRow('Curve value at this TVL', fmtUsd(recomputed.curve_usd)),
        eqRow('Category effect', fmtMult(recomputed.category_multiplier)),
        eqRow('Growth factor', fmtMult(recomputed.growth_factor)),
        eqRow('Age factor', fmtMult(recomputed.age_factor)),
        eqRow('Backtest band', fmtUsd(row.low_usd) + ' \u2013 ' + fmtUsd(row.high_usd)),
        eqRow('Integrity flags', flagsText),
        eqRow('Implied value', fmtUsd(row.implied_value_usd), true)
      ),
      el('p', { class: 'check' },
        'Model ' + DATA.model_version + ': this page recomputes the row as ',
        el('b', { text: fmtUsd(recomputed.implied_value_usd) }),
        matches ? ', the same number the board carries, band and all.' : ', which differs from the board: the data would be stale.',
        ' This is an estimate, not a price.'
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.lastIndexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        var costAt = tail.lastIndexOf(' Time: ');
        var cost = costAt >= 0 ? tail.slice(0, costAt) : tail;
        var time = costAt >= 0 ? tail.slice(costAt + 1) : '';
        return el('li', null,
          el('b', { text: action }),
          el('span', { class: 'cost' }, el('b', { text: cost }), time ? ' \u00B7 ' + time : '')
        );
      })),
      el('p', { class: 'check', text: 'Netted at the band\u2019s low end at a stated 10% farmer share: FARM at 50,000 farmers covered, THIN at 5,000, SKIP below that.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    // render() rebuilds the page: remember focus, and put it back.
    var active = document.activeElement;
    var focusId = active && active.id ? active.id : null;
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(tabBar());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : state.tab === 'live' ? liveTable() : setAsideTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    if (focusId) {
      var next = document.getElementById(focusId);
      if (next) next.focus();
    }
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected && !dialog.open) openDetail(state.selected);
  }

  readHash();
  render();
})();
