// The farm-plan generator, shared by main.ts and the dashboard page.
// Seven steps per row, each an action with its cost and time, from the
// protocol's own record only: wallet by chain family, action and weekly
// action by category group, hold by age band and peers' launch odds,
// claim by category group, log by verdict, and a seventh step netting
// the plan at a stated 10% farmer share against the gas bill. No name
// is special-cased. Classic script: sets window.RadarPlan. Required from
// Node: exports the same object. No imports, no network.

(function (root) {
  'use strict';

  /** Chains where a transaction costs cents, by DefiLlama's name. A regex, so `constructor` cannot match the prototype. */
  var CHEAP_CHAINS = /^(arbitrum|avalanche|base|binance|blast|bob|celo|fantom|fraxtal|gnosis|hyperliquid|injective|ink|linea|lisk|mantle|mode|monad|movement|near|opbnb|optimism|plasma|polygon|ripple|sei|solana|soneium|sonic|sui|aptos|scroll|tron|unichain|zksync|zircuit|berachain|plume|megaeth|abstract|apechain|bitlayer|core|kava|merlin|osmosis|ton|bsc|bnb)$/;

  /** Cosmos-ecosystem chains, whose wallets are Keplr-style rather than EVM. */
  var COSMOS_CHAINS = /^(cosmos|osmosis|injective|kava|neutron|stargaze|celestia|dydx)$/;

  /** A chain's gas tier: Ethereum is dear, the cheap set costs cents, the rest between. */
  function gasTier(chain) {
    var name = String(chain || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    // "Ethereum L1" is Ethereum: the first word decides, as with the cheap set below.
    if (name.split(' ')[0] === 'ethereum') return 'high';
    if (CHEAP_CHAINS.test(name)) return 'low';
    // Names such as "Hyperliquid L1" carry the cheap chain's name plus a suffix.
    var first = name.split(' ')[0];
    if (CHEAP_CHAINS.test(first)) return 'low';
    return 'medium';
  }

  /** One transaction's dollars and words on a gas tier. */
  function gasUsd(tier) {
    return tier === 'high' ? 6 : tier === 'low' ? 0.5 : 2;
  }
  function gasText(tier) {
    return tier === 'high' ? 'about $6 of gas' : tier === 'low' ? 'under $0.50 of gas' : 'about $2 of gas';
  }

  /** The assumed share of a launch's value reaching farmers, stated wherever used. */
  var FARMER_SHARE = 0.1;

  /** Compact dollars: $1.2M, $340K, $45. Rounding carries up a unit, never $1000K. Shared with the page. */
  function fmtUsd(n) {
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6 >= 999.95 ? (a / 1e9).toFixed(2) + 'B' : (a / 1e6).toFixed(1) + 'M');
    if (a >= 1e3) { var k = Math.round(a / 1e3); return k >= 1000 ? sign + '$' + (a / 1e6).toFixed(1) + 'M' : sign + '$' + k + 'K'; }
    return sign + '$' + Math.round(a);
  }

  /** The plan's economics, netted: the whole gas bill against the farmer pool
   * at the band's low end (`lowUsd`). FARM at 50,000 farmers covered, THIN at
   * 5,000, SKIP below that. */
  function planEconomics(row, lowUsd) {
    var tier = gasTier(chainOf(row));
    var capital = capitalFor(row.tvl_usd);
    var hold = holdDaysFor(row.age_days);
    var txs = 3 + Math.ceil(hold / 7);
    var gas = gasUsd(tier) * txs;
    var pool = Math.max(0, (lowUsd || 0) * FARMER_SHARE);
    var farmers = gas > 0 ? Math.floor(pool / gas) : 0;
    var verdict = farmers >= 50000 ? 'FARM' : farmers >= 5000 ? 'THIN' : 'SKIP';
    return { gas_usd: gas, tx_count: txs, capital_usd: capital, hold_days: hold, pool_usd: Math.round(pool), farmers: farmers, verdict: verdict };
  }

  /** The capital one farm position needs, from the protocol's TVL. */
  function capitalFor(tvlUsd) {
    if (tvlUsd >= 5000000000) return 250;
    if (tvlUsd >= 1000000000) return 150;
    if (tvlUsd >= 100000000) return 100;
    return 50;
  }

  /** The hold, from the protocol's age: younger protocols hold longer. */
  function holdDaysFor(ageDays) {
    if (ageDays === null || ageDays === undefined) return 45;
    if (ageDays < 180) return 60;
    if (ageDays < 365) return 45;
    return 30;
  }

  /** The first chain named, or a neutral phrase. */
  function chainOf(row) {
    return row.chains && row.chains.length > 0 ? row.chains[0] : 'its main chain';
  }

  /** The wallet to open, by chain family: Solana, Cosmos, or EVM by default. */
  function walletFor(chain) {
    var first = String(chain || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(' ')[0];
    if (first === 'solana') return 'a fresh Phantom wallet on Solana';
    if (COSMOS_CHAINS.test(first)) return 'a fresh Keplr wallet for ' + chain;
    return 'a fresh EVM wallet (MetaMask or Rabby) for ' + chain;
  }

  /** The category group a row belongs to: [group, keywords], first match wins. */
  var GROUPS = [
    ['lending', ['lend', 'cdp', 'collateral']],
    ['yield', ['liquid staking', 'liquid restaking', 'restak']],
    ['bridge', ['bridge', 'chain']],
    ['generic', ['index']],
    ['dex', ['dex']],
    ['yield', ['yield', 'leveraged farm', 'farm']],
    ['dex', ['derivative', 'perpetual', 'options']],
    ['rwa', ['rwa']],
  ];
  function groupOf(row) {
    var c = String(row.category || '').toLowerCase();
    for (var i = 0; i < GROUPS.length; i++) {
      var keys = GROUPS[i][1];
      for (var j = 0; j < keys.length; j++) if (c.indexOf(keys[j]) >= 0) return GROUPS[i][0];
    }
    return 'generic';
  }

  /** Fill a step template: $C is the capital, $N the name, $H the chain. */
  function fill(t, capital, name, chain) {
    return t.split('$C').join('$' + capital).split('$N').join(name).split('$H').join(chain);
  }

  /** The category's one action, in words a farmer can follow: [keywords, template], first match wins. */
  var ACTIONS = [
    [['lend', 'cdp', 'collateral'], 'Supply $C of USDC to $N on $H and keep the position open.'],
    [['liquid staking', 'liquid restaking', 'restak', 'staking pool'], 'Stake $C of the staking asset through $N on $H and keep the receipt token.'],
    [['bridge'], 'Bridge $C of USDC to $H through $N, then use the bridged funds in its app.'],
    [['index'], 'Buy $C of the index token $N issues on $H and hold it.'],
    [['dex'], "Provide $C of liquidity to $N's main pool on $H and keep the position open."],
    [['yield aggregator', 'yield', 'leveraged farm', 'farm'], "Deposit $C of USDC into $N's top vault on $H and keep the shares."],
    [['derivative', 'perpetual', 'options'], 'Deposit $C of USDC as margin on $N on $H and open a small hedged position.'],
    [['rwa'], 'Mint $C of the yield-bearing asset $N issues on $H and hold it.'],
    [['basis trading'], "Deposit $C into $N's basis vault on $H and let one full funding cycle run."],
    [['risk curator', 'capital allocator', 'liquidity manager', 'allocator'], 'Deposit $C into a $N curated vault on $H and keep the shares.'],
    [['prediction'], 'Fund the farm wallet with $C and place one market position on $N on $H.'],
    [['insurance'], 'Buy $C of cover from $N on $H and keep the policy active.'],
    [['launchpad'], 'Commit $C through $N on $H to qualify for its next allocation round.'],
    [['chain'], "Bridge $C of USDC to $H and use $N's flagship apps at least once a week."],
    [['gaming', 'nft'], "Hold $C of $N's in-app assets on $H and finish one quest or season action a week."],
    [['social'], 'Create one profile on $N on $H, fund it with $C, and post or engage once a week.'],
    [['token locker', 'locker'], 'Lock $C of tokens through $N on $H and keep the lock receipt.'],
  ];
  function actionFor(row, capital, chain) {
    var c = String(row.category || '').toLowerCase();
    for (var i = 0; i < ACTIONS.length; i++) {
      var keys = ACTIONS[i][0];
      for (var j = 0; j < keys.length; j++) {
        if (c.indexOf(keys[j]) >= 0) return fill(ACTIONS[i][1], capital, row.name, chain);
      }
    }
    // Whole-word 'ai' only: 'domains' carries the letters, not the meaning.
    if (c.split(/[^a-z0-9]+/).indexOf('ai') >= 0) return fill('Spend $C of usage on $N on $H across the hold, one paid action a week.', capital, row.name, chain);
    return 'Deposit $' + capital + ' of USDC into ' + row.name + ' on ' + chain + ' and keep the position open.';
  }

  /** The weekly action, by category group: the same kind of work the position already does. */
  var WEEKLY = {
    lending: 'Return weekly for one small supply or borrow, keeping the position open so the age counter keeps running.',
    dex: 'Swap once a week, rotating pairs, and leave the liquidity slice in place between weeks.',
    yield: "Claim and restake the vault's rewards weekly; compounding is what its points usually count.",
    bridge: 'Bridge a small amount in each direction weekly; regular volume matters more than one large transfer.',
    rwa: "Check the holding weekly and top it up only if the asset's terms changed; holding time is the score.",
    generic: 'Do one qualifying action a week — a deposit, swap, vote or claim — so the wallet stays active across snapshots.',
  };
  function weeklyFor(row) {
    return WEEKLY[groupOf(row)] || WEEKLY.generic;
  }

  /** The launch odds, as a whole percent, when the row carries them. */
  function oddsPct(row) {
    return typeof row.launch_odds === 'number' && isFinite(row.launch_odds) ? Math.round(row.launch_odds * 100) : null;
  }

  /** The hold, by age band, with the peers' launch odds when known. */
  function holdFor(row, hold) {
    var odds = oddsPct(row);
    var age = row.age_days;
    var pct = odds !== null ? odds + '% of the time' : null;
    if (age === null || age === undefined) {
      return 'Hold at least ' + hold + ' days; no listing date is on record, so use the middle hold and re-check the points page monthly.';
    }
    if (age < 180) {
      return 'Hold at least ' + hold + ' days: ' + row.name + ' is only ' + age + ' days old' +
        (pct ? ', and peers this young and this big launched a token ' + pct : '') + ', so the wait is the bet.';
    }
    if (age < 365) {
      return 'Hold at least ' + hold + ' days' + (pct ? ': peers this old and this big launched a token ' + pct : '') + '.';
    }
    return 'Hold at least ' + hold + ' days: ' + row.name + ' has run ' + age + ' days without a token' +
      (pct ? ' and peers like it launched a token ' + pct : '') + ', so a shorter hold is enough.';
  }

  /** The claim, by category group: where the reward lands differs by what was farmed. */
  var CLAIM = {
    lending: 'repay any borrow first if the claim needs a clean position.',
    dex: 'sell half the airdrop for USDC and keep half in case the token runs.',
    yield: 'then withdraw the vault deposit in the same session so nothing sits idle.',
    bridge: 'bridge rewards often vest, so claim on day one and note the unlock date.',
    rwa: 'RWA drops can be slow to list, so claim and hold until a market exists.',
    generic: 'never pay anyone to claim for you.',
  };
  function claimFor(row) {
    return "Before withdrawing, open " + row.name + "'s own points page from its official site and claim only from the link it publishes; " + (CLAIM[groupOf(row)] || CLAIM.generic);
  }

  /** The log, by verdict: a fat farm earns bookkeeping, a skip earns one line. */
  var LOG = {
    FARM: 'Record the wallet address, dates and every transaction hash in a farm log; after 12 weeks the log is your proof if a snapshot is disputed.',
    SKIP: 'Record the wallet and the reason to skip once; re-check this protocol in 90 days in case a token plan appears.',
    THIN: 'Record the position once and revisit it monthly; a thin farm is not worth weekly bookkeeping.',
  };
  function logFor(row, verdict) {
    var text = LOG[verdict] || LOG.THIN;
    return verdict === 'SKIP' ? text.replace('this protocol', function () { return row.name; }) : text;
  }

  /** One step: action, cost and time in a single string, 20 to 600 chars. */
  function stepText(text, cost, time) {
    // Cut the action, never the cost/time tail.
    var tail = ' Cost: ' + cost + '. Time: ' + time + '.';
    var s = text.length + tail.length > 600 ? text.slice(0, 600 - tail.length - 3) + '...' + tail : text + tail;
    return s;
  }

  /** Six action steps plus the netting step (six only when `row.low_usd` is absent). */
  function buildFarmSteps(row) {
    var chain = chainOf(row);
    var tier = gasTier(chain);
    var capital = capitalFor(row.tvl_usd);
    var hold = holdDaysFor(row.age_days);
    var econ = typeof row.low_usd === 'number' && isFinite(row.low_usd) ? planEconomics(row, row.low_usd) : null;
    var verdict = econ ? econ.verdict : 'THIN';
    var steps = [
      ['Open ' + walletFor(chain) + ', fund it with $' + capital + ' USDC, and store its seed offline — never in a screenshot or chat.',
        gasText(tier) + ' for the first transaction', '5 minutes'],
      [actionFor(row, capital, chain),
        '$' + capital + ' of capital and ' + gasText(tier), '15 minutes to set up'],
      [weeklyFor(row),
        gasText(tier) + ' a week', '10 minutes a week'],
      [holdFor(row, hold),
        'the $' + capital + ' stays in the position', hold + ' days'],
      [claimFor(row),
        'no fee to check; ' + gasText(tier) + ' to claim', '10 minutes'],
      [logFor(row, verdict),
        'nothing but the log', verdict === 'FARM' ? '5 minutes a week' : '5 minutes'],
    ].map(function (s) { return stepText(s[0], s[1], s[2]); });
    if (econ) {
      var odds = oddsPct(row);
      steps.push(stepText(
        'Net the plan: at the band\u2019s low end of ' + fmtUsd(row.low_usd) + ', a 10% farmer share (an assumption) is ' + fmtUsd(econ.pool_usd) +
          ', against $' + econ.gas_usd + ' of gas over ' + econ.tx_count + ' transactions, covering about ' +
          econ.farmers.toLocaleString('en-US') + ' farmers: ' + econ.verdict + '.' +
          (odds !== null ? ' Peers this old and this big launched a token ' + odds + '% of the time.' : ''),
        '$' + econ.gas_usd + ' of gas in all, $' + econ.capital_usd + ' of capital held',
        econ.hold_days + ' days of holding'
      ));
    }
    return steps;
  }

  var api = { buildFarmSteps: buildFarmSteps, planEconomics: planEconomics, capitalFor: capitalFor, holdDaysFor: holdDaysFor, gasTier: gasTier, fmtUsd: fmtUsd, farmerShare: FARMER_SHARE };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RadarPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
