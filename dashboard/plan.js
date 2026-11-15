// The farm-plan generator, shared by main.ts and the dashboard page.
//
// Every board row carries a plan of six steps, each an action with what it costs
// and how long it takes. The plan is derived from the protocol's own record only:
// its category decides the action, its first chain decides the gas tier, its TVL
// decides the capital, and its age decides the hold. No protocol name is ever
// special-cased. main.ts writes these same strings to board.json, and the page
// generates them from the same row data, so the plan a screenshot shows is the
// plan the board carries.
//
// Loaded two ways: as a classic script it sets window.RadarPlan; required from
// Node (main.ts imports it) it exports the same object. No imports, no network.

(function (root) {
  'use strict';

  /** Chains where a transaction costs cents, by the name DefiLlama gives them. */
  var CHEAP_CHAINS = {
    arbitrum: 1, avalanche: 1, base: 1, binance: 1, blast: 1, bob: 1, celo: 1,
    fantom: 1, fraxtal: 1, gnosis: 1, hyperliquid: 1, injective: 1, ink: 1,
    linea: 1, lisk: 1, mantle: 1, mode: 1, monad: 1, movement: 1, near: 1,
    opbnb: 1, optimism: 1, plasma: 1, polygon: 1, ripple: 1, sei: 1, solana: 1,
    soneium: 1, sonic: 1, sui: 1, aptos: 1, scroll: 1, tron: 1, unichain: 1,
    zksync: 1, zircuit: 1, berachain: 1, plume: 1, megaeth: 1, abstract: 1,
    apechain: 1, bitlayer: 1, core: 1, kava: 1, merlin: 1, osmosis: 1, ton: 1,
  };

  /** The gas tier of a chain: Ethereum is dear, the cheap set costs cents, the rest sit between. */
  function gasTier(chain) {
    var name = String(chain || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (name === 'ethereum') return 'high';
    if (CHEAP_CHAINS[name]) return 'low';
    // Names such as "Hyperliquid L1" carry the cheap chain's name plus a suffix.
    var first = name.split(' ')[0];
    if (CHEAP_CHAINS[first]) return 'low';
    return 'medium';
  }

  function gasText(tier) {
    if (tier === 'high') return 'about $6 of gas';
    if (tier === 'low') return 'under $0.50 of gas';
    return 'about $2 of gas';
  }

  /** How much capital one farm position needs, from the protocol's own TVL. */
  function capitalFor(tvlUsd) {
    if (tvlUsd >= 5000000000) return 250;
    if (tvlUsd >= 1000000000) return 150;
    if (tvlUsd >= 100000000) return 100;
    return 50;
  }

  /** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
  function holdDaysFor(ageDays) {
    if (ageDays === null || ageDays === undefined) return 45;
    if (ageDays < 180) return 60;
    if (ageDays < 365) return 45;
    return 30;
  }

  /** The first chain a protocol names, or a neutral phrase. */
  function chainOf(row) {
    return row.chains && row.chains.length > 0 ? row.chains[0] : 'its main chain';
  }

  /** The category's one action, in the words a farmer can follow. */
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
    if (c.indexOf('index') >= 0) {
      return 'Buy $' + capital + ' of the index token ' + name + ' issues on ' + chain + ' and hold it in the farm wallet.';
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
    if (c.indexOf('ai') >= 0) {
      return 'Spend $' + capital + ' of usage on ' + name + ' on ' + chain + ' across the hold, one paid action a week.';
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }

  /** One step as a single string: its action, then its cost and time, within 20 to 600 characters. */
  function stepText(text, cost, time) {
    var s = text + ' Cost: ' + cost + '. Time: ' + time + '.';
    if (s.length > 600) s = s.slice(0, 597) + '...';
    if (s.length < 20) s += ' Hold the position and check the protocol\'s own page.';
    return s;
  }

  /**
   * A protocol's farm plan: six steps, each an action with a cost and a time.
   * `row` carries name, category, chains, tvl_usd and age_days.
   */
  function buildFarmSteps(row) {
    var chain = chainOf(row);
    var tier = gasTier(chain);
    var capital = capitalFor(row.tvl_usd);
    var hold = holdDaysFor(row.age_days);
    return [
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
        'no fee to check, and never pay to claim',
        '10 minutes'
      ),
      stepText(
        'Record the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.',
        'nothing but the log',
        '5 minutes'
      ),
    ];
  }

  var api = { buildFarmSteps: buildFarmSteps, capitalFor: capitalFor, holdDaysFor: holdDaysFor, gasTier: gasTier };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RadarPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
