// The farm-plan generator, shared by main.ts and the dashboard page.
//
// Seven steps per row, each an action with its cost and time, from the
// protocol's own record only: category decides the action, first chain the
// gas tier, TVL the capital, age the hold. No name is special-cased. The
// seventh step nets the plan at a stated 10% farmer share — an assumption,
// labelled as one, never a fact — against the gas bill, giving the farmers
// covered and the verdict: FARM, THIN or SKIP.
//
// Classic script: sets window.RadarPlan. Required from Node: exports the
// same object. No imports, no network.

(function (root) {
  'use strict';

  /** Chains where a transaction costs cents, by DefiLlama's name. A Set, so `constructor` cannot match the prototype. */
  var CHEAP_CHAINS = new Set([
    'arbitrum', 'avalanche', 'base', 'binance', 'blast', 'bob', 'celo',
    'fantom', 'fraxtal', 'gnosis', 'hyperliquid', 'injective', 'ink',
    'linea', 'lisk', 'mantle', 'mode', 'monad', 'movement', 'near',
    'opbnb', 'optimism', 'plasma', 'polygon', 'ripple', 'sei', 'solana',
    'soneium', 'sonic', 'sui', 'aptos', 'scroll', 'tron', 'unichain',
    'zksync', 'zircuit', 'berachain', 'plume', 'megaeth', 'abstract',
    'apechain', 'bitlayer', 'core', 'kava', 'merlin', 'osmosis', 'ton',
    'bsc', 'bnb',
  ]);

  /** A chain's gas tier: Ethereum is dear, the cheap set costs cents, the rest between. */
  function gasTier(chain) {
    var name = String(chain || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    // "Ethereum L1" is Ethereum: the first word decides, as with the cheap set below.
    if (name.split(' ')[0] === 'ethereum') return 'high';
    if (CHEAP_CHAINS.has(name)) return 'low';
    // Names such as "Hyperliquid L1" carry the cheap chain's name plus a suffix.
    var first = name.split(' ')[0];
    if (CHEAP_CHAINS.has(first)) return 'low';
    return 'medium';
  }

  function gasText(tier) {
    if (tier === 'high') return 'about $6 of gas';
    if (tier === 'low') return 'under $0.50 of gas';
    return 'about $2 of gas';
  }

  /** One transaction's dollars on a gas tier. */
  function gasUsd(tier) {
    if (tier === 'high') return 6;
    if (tier === 'low') return 0.5;
    return 2;
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

  /** The category's one action, in words a farmer can follow. */
  function actionFor(row, capital, chain) {
    var c = String(row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) {
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the supply position open.';
    }
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('staking pool') >= 0) {
      return 'Stake $' + capital + ' of the chain staking asset through ' + name + ' on ' + chain + ' and keep the receipt token.';
    }
    if (c.indexOf('bridge') >= 0) {
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds inside its app.';
    }
    if (c.indexOf('index') >= 0) {
      return 'Buy $' + capital + ' of the index token ' + name + ' issues on ' + chain + ' and hold it in the farm wallet.';
    }
    if (c.indexOf('dex') >= 0) {
      return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    }
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) {
      return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL vault on " + chain + ' and keep the shares.';
    }
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) {
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position.';
    }
    if (c.indexOf('rwa') >= 0) {
      return 'Mint $' + capital + ' of the yield-bearing asset ' + name + ' issues on ' + chain + ' and hold it in the farm wallet.';
    }
    if (c.indexOf('basis trading') >= 0) {
      return 'Deposit $' + capital + ' into ' + name + "'s basis vault on " + chain + ' and let one full funding cycle run.';
    }
    if (c.indexOf('risk curator') >= 0 || c.indexOf('capital allocator') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('allocator') >= 0) {
      return 'Deposit $' + capital + ' into a ' + name + ' curated vault on ' + chain + ' and keep the vault shares.';
    }
    if (c.indexOf('prediction') >= 0) {
      return 'Fund the farm wallet with $' + capital + ' and place one market position on ' + name + ' on ' + chain + '.';
    }
    if (c.indexOf('insurance') >= 0) {
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the hold.';
    }
    if (c.indexOf('launchpad') >= 0) {
      return 'Commit $' + capital + ' through ' + name + ' on ' + chain + ' to qualify for its next allocation round.';
    }
    if (c.indexOf('chain') >= 0) {
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' and use ' + name + "'s flagship apps at least once a week.";
    }
    if (c.indexOf('gaming') >= 0 || c.indexOf('nft') >= 0) {
      return 'Hold $' + capital + ' of ' + name + "'s in-app assets on " + chain + ' and complete one quest or season action a week.';
    }
    if (c.indexOf('social') >= 0) {
      return 'Create one profile on ' + name + ' on ' + chain + ', fund it with $' + capital + ', and post or engage once a week.';
    }
    if (c.indexOf('token locker') >= 0 || c.indexOf('locker') >= 0) {
      return 'Lock $' + capital + ' of tokens through ' + name + ' on ' + chain + ' and keep the lock receipt for the hold.';
    }
    // Whole-word 'ai' only: 'domains' carries the letters, not the meaning.
    if (c.split(/[^a-z0-9]+/).indexOf('ai') >= 0) {
      return 'Spend $' + capital + ' of usage on ' + name + ' on ' + chain + ' across the hold, one paid action a week.';
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }

  /** One step: action, cost and time in a single string, 20 to 600 chars. */
  function stepText(text, cost, time) {
    // Cut the action, never the cost/time tail.
    var tail = ' Cost: ' + cost + '. Time: ' + time + '.';
    var s = text.length + tail.length > 600 ? text.slice(0, 600 - tail.length - 3) + '...' + tail : text + tail;
    if (s.length < 20) s += ' Hold the position and check the protocol\'s own page.';
    return s;
  }

  /** Six action steps plus the netting step (six only when `row.low_usd` is absent). */
  function buildFarmSteps(row) {
    var chain = chainOf(row);
    var tier = gasTier(chain);
    var capital = capitalFor(row.tvl_usd);
    var hold = holdDaysFor(row.age_days);
    var steps = [
      stepText(
        'Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline, never in a screenshot or chat.',
        gasText(tier) + ' for the first transaction',
        '5 minutes'
      ),
      stepText(
        actionFor(row, capital, chain),
        '$' + capital + ' of capital and ' + gasText(tier),
        '15 minutes to set up'
      ),
      stepText(
        'Return once a week and make one qualifying action, such as a deposit, a borrow, a swap, a vote or a claim, so the wallet stays active across snapshots.',
        gasText(tier) + ' a week',
        '10 minutes a week'
      ),
      stepText(
        'Hold the position for at least ' + hold + ' days so the activity lands in more than one snapshot window.',
        'the $' + capital + ' stays in the position',
        hold + ' days'
      ),
      stepText(
        "Before withdrawing, open the protocol's own points or rewards page from its official site and claim only from the link it publishes; never pay anyone to claim for you.",
        'no fee to check; ' + gasText(tier) + ' to claim',
        '10 minutes'
      ),
      stepText(
        'Record the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.',
        'nothing but the log',
        '5 minutes'
      ),
    ];
    if (typeof row.low_usd === 'number' && isFinite(row.low_usd)) {
      var econ = planEconomics(row, row.low_usd);
      steps.push(stepText(
        'Net the plan: at the band\u2019s low end of ' + fmtUsd(row.low_usd) + ', a 10% farmer share (an assumption) is ' + fmtUsd(econ.pool_usd) +
          ', against $' + econ.gas_usd + ' of gas over ' + econ.tx_count + ' transactions, so the launch covers about ' +
          econ.farmers.toLocaleString('en-US') + ' farmers at this cost: ' + econ.verdict + '.',
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
