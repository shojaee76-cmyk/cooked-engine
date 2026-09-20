/* ============================================================================
   COOKED — the roast engine.
   Data in, measured facts out, then a receipt composed with sequencing rules.
   No line is generated from nothing: every printed fact carries its own numbers.
   ========================================================================== */

/* ------------------------------------------------------------ formatting */
const fmt = {
  usd(v, dp) {
    if (v == null || !isFinite(v)) return "an unknown amount";
    const a = Math.abs(v);
    if (a >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
    if (a >= 1000) return "$" + Math.round(v).toLocaleString("en-US");
    if (a >= 100) return "$" + v.toFixed(0);
    if (a >= 1) return "$" + v.toFixed(2);
    if (a >= 0.01) return "$" + v.toFixed(3);
    if (a > 0) return "$" + v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    return "$0";
  },
  int(v) { return v == null || !isFinite(v) ? "0" : Math.round(v).toLocaleString("en-US"); },
  dec(v, d = 1) { return v == null || !isFinite(v) ? "0" : v.toFixed(d); },
  pct(v, d = 1) { return v == null || !isFinite(v) ? "0" : v.toFixed(d) + "%"; },
  years(v) {
    if (v == null) return "an unknown number of";
    if (v < 1) return "under a";
    return String(Math.floor(v));
  },
  short(a) { return a ? a.slice(0, 6) + "\u2026" + a.slice(-4) : "0x0"; },
};

function clamp(v, a = 0, b = 100) { return Math.max(a, Math.min(b, v)); }
function logScale(v, cap) { return clamp((Math.log10(Math.max(1, v)) / Math.log10(cap)) * 100); }

/* Deterministic RNG so the same wallet gets a stable receipt for the day,
   and a different one when the visitor asks for a reprint with a salt. */
function rng(seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return function () {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}
function pick(arr, r) { return arr.length ? arr[Math.floor(r() * arr.length) % arr.length] : null; }

/* ------------------------------------------------------- token normalise */
const STABLES = new Set(["USDC", "USDC.E", "USDT", "USDT0", "DAI", "USDE", "FRAX", "BUSD", "TUSD",
  "PUSD", "GUSD", "USDGLO", "PYUSD", "LUSD", "SUSD", "USD+", "USDD", "EURC", "EURE"]);

function classifyToken(t) {
  const sym = String(t.sym || "?").toUpperCase();
  let usd = t.usd != null && isFinite(t.usd) ? t.usd : null;
  const holders = t.holders != null && isFinite(t.holders) ? t.holders : null;
  const bal = t.balance != null && isFinite(t.balance) ? t.balance : 0;
  /* decimals artifacts: an unpriceable balance must never become a dollar figure */
  const suspect = t.conflict === true || bal > TH.absurdBalance
    || (usd != null && usd > TH.absurdUsd && (holders == null || holders < 1000));
  if (suspect) usd = null;
  const priced = usd != null;
  const spam = (!priced && holders != null && holders < TH.spamHolders) ||
               (priced && usd < TH.spamUsd && holders != null && holders < TH.spamHolders) ||
               (sym === "?" && (usd == null || usd < 1));
  const fake_major = MAJOR_TICKERS.includes(sym) && holders != null && holders < TH.fakeMajorHolders
    && (usd == null || usd >= 1);
  return { ...t, sym, usd, holders, priced, spam, fake_major, stable: STABLES.has(sym) };
}

/* Fold the raw chain reads into one measured picture. */
function measureChains(rows, tokensRaw, extras) {
  const chains = rows.filter(Boolean).map((c) => {
    const tok = tokensRaw.find((t) => t.chain === c.chain) || null;
    return {
      key: c.chain, label: (CHAINS.find((x) => x.key === c.chain) || {}).label || c.chain,
      sym: (CHAINS.find((x) => x.key === c.chain) || {}).sym || "?",
      balance: c.balance, usd: c.usd, nonce: c.nonce,
      tx_count: tok && tok.counters ? tok.counters.tx_count : null,
      gas_used: tok && tok.counters ? tok.counters.gas_used : null,
      token_transfers: tok && tok.counters ? tok.counters.token_transfers : null,
      gas_price_wei: c.gasPriceWei, block: c.block, rpc: c.rpc,
      /* An EIP-7702 delegated EOA carries a 0xef0100 designator: that is a
         delegation, not a contract. Getting it wrong turns every modern wallet
         into "you are not a person". */
      is_contract: !!(c.code && c.code !== "0x" && !/^0xef0100/i.test(c.code)),
      delegate: /^0xef0100/i.test(c.code || "") ? "0x" + (c.code || "").slice(8, 48) : null,
      ok: true,
    };
  });

  const tokens = tokensRaw.filter((t) => t && t.tokens).flatMap((t) => t.tokens.map(classifyToken));
  const priced = tokens.filter((t) => t.priced && !t.spam);
  const spamTokens = tokens.filter((t) => t.spam);
  const unpriced = tokens.filter((t) => !t.priced);

  const dust = priced.filter((t) => t.usd < TH.dustUsd);
  const stableUsd = priced.filter((t) => t.stable).reduce((a, t) => a + t.usd, 0);
  const nativeUsd = chains.reduce((a, c) => a + (c.usd || 0), 0);
  const tokenUsd = priced.reduce((a, t) => a + t.usd, 0);
  const netWorth = nativeUsd + tokenUsd;
  const spamUsd = spamTokens.reduce((a, t) => a + (t.usd || 0), 0);

  const gasUsed = chains.reduce((a, c) => a + (c.gas_used || 0), 0);
  const txCount = chains.reduce((a, c) => a + Math.max(c.tx_count || 0, c.nonce || 0), 0);
  const tokenTransfers = chains.reduce((a, c) => a + (c.token_transfers || 0), 0);
  /* Gas is real (address-level gas used). The dollar figure converts it at today's
     gas price, which we label on the receipt as an estimate. */
  const prices = extras.prices || {};
  let gasUsd = 0, gasKnown = false;
  for (const c of chains) {
    const cdef = CHAINS.find((x) => x.key === c.key) || {};
    const native = prices[cdef.cg] || 0;
    if (c.gas_used && c.gas_price_wei && native) {
      gasUsd += (c.gas_used * Number(c.gas_price_wei) / 1e18) * native;
      gasKnown = true;
    }
  }

  const sortedByUsd = [...priced].sort((a, b) => b.usd - a.usd);
  const top = sortedByUsd[0] || null;
  /* only positions with real value count for the small-holders line: otherwise
     the joke lands on a $0.00 balance and reads as a bug */
  const minHolders = priced.filter((t) => t.holders != null && t.holders > 0 && t.usd >= 0.5)
    .sort((a, b) => a.holders - b.holders)[0] || null;
  const loser = (extras.changes && priced.length)
    ? priced.map((t) => ({ t, chg: extras.changes[t.addr] })).filter((x) => x.chg != null && x.chg < -3)
        .sort((a, b) => a.chg - b.chg)[0] || null
    : null;

  return {
    chains, tokens, priced, spamTokens, unpriced, dust,
    nativeUsd, tokenUsd, netWorth, spamUsd, stableUsd, gasUsed, gasUsd, gasKnown, txCount, tokenTransfers,
    tokenCount: tokens.length, dustCount: dust.length, unpricedCount: unpriced.length,
    spamCount: spamTokens.length, chainsActive: chains.filter((c) => c.usd > 0.5 || c.nonce > 0).length,
    top, minHolders, loser,
    isContract: chains.some((c) => c.is_contract),
    delegate: (chains.find((c) => c.delegate) || {}).delegate || null,
    zeroActivity: chains.every((c) => (c.nonce || 0) === 0) && tokens.length === 0,
    prices, ethChg: (extras.ethplorer && extras.ethplorer.ethChg) || null,
  };
}

/* --------------------------------------------------------- fact builders */
/* Each builder returns a fact object or null. Numbers are formatted here so a
   line can never print an empty slot. */
function buildFacts(M, X, I, input) {
  const f = [];
  const push = (id, family, weight, tier, slots, measured, fb) => {
    if (Object.values(slots).some((v) => v == null)) return;
    f.push({ id, family, weight, tier, slots, measured, fb: fb || null });
  };

  /* ---- the situation (always printed first when available) */
  if (M.kind === "evm" && M.netWorth > 0) {
    if (M.netWorth < TH.thinWallet) push("broke", "chain", 6, "medium", { netWorth: fmt.usd(M.netWorth), chainsActive: fmt.int(M.chainsActive) }, { netWorth: M.netWorth });
    else if (M.netWorth < 5000) push("thin", "chain", 5, "medium", { netWorth: fmt.usd(M.netWorth), years: fmt.years(X && X.years) }, { netWorth: M.netWorth });
    else push("total_usd", "chain", 4, "gentle", { netWorth: fmt.usd(M.netWorth), chainsActive: fmt.int(M.chainsActive) }, { netWorth: M.netWorth });
  }
  if (M.zeroActivity && M.kind === "evm") {
    push("empty_address", "identity", 9, "savage", { addr: fmt.short(input.wallet), chainsActive: fmt.int(CHAINS.length) }, {},
      "That address has never sent a transaction on any chain we read. It exists as a destination for other people's mistakes.");
  }
  if (M.isContract) push("contract_wallet", "identity", 10, "savage", { addr: fmt.short(input.wallet) }, {},
    "You did not paste a wallet. You pasted a contract, wearing a wallet's address as a disguise.");
  if (M.delegate) push("smart_account", "identity", 8, "medium", { delegate: fmt.short(M.delegate) }, { delegate: M.delegate },
    "Your account is delegated to {delegate}. You handed a stranger the keys and kept the receipts.");
  if (M.kind === "none") push("no_wallet", "identity", 5, "gentle", {}, {},
    "No wallet on file, so the chain stays unread and this receipt is about the posting only.");
  if (M.kind === "solana") {
    push("sol_total", "chain", 6, "gentle", { netWorth: fmt.usd(M.netWorth) }, {},
      "Solana balance: {netWorth}. One chain, one wallet, nobody to blame.");
    push("sol_scope", "identity", 3, "gentle", { netWorth: fmt.usd(M.netWorth) }, {},
      "This receipt reads Solana holdings, not Solana history. The balances are measured; behaviour on Solana is not judged here.");
  }

  /* ---- dust, spam, unpriced: printed as an escalation when all three exist */
  if (M.tokenCount > 0) {
    if (M.dustCount >= 5) push("dust", "chain", 7, "medium",
      { dustCount: fmt.int(M.dustCount), tokenCount: fmt.int(M.tokenCount), dustUsd: fmt.usd(M.dust.reduce((a, t) => a + t.usd, 0)) },
      { dustCount: M.dustCount });
    if (M.unpricedCount >= 10) push("unpriced", "chain", 7, "medium",
      { unpricedCount: fmt.int(M.unpricedCount), tokenCount: fmt.int(M.tokenCount) }, { unpricedCount: M.unpricedCount });
    if (M.spamCount >= 10 && M.spamUsd >= 1) push("spam_usd", "chain", 8, "savage",
      { spamUsd: fmt.usd(M.spamUsd), netWorth: fmt.usd(M.netWorth) }, { spamCount: M.spamCount, spamUsd: M.spamUsd });
    else if (M.spamCount >= 20) push("spam_count", "chain", 7, "medium",
      { spamCount: fmt.int(M.spamCount), tokenCount: fmt.int(M.tokenCount), netWorth: fmt.usd(M.netWorth) }, {},
      "{spamCount} of your {tokenCount} tokens are airdropped junk somebody hoped you would trade. The {netWorth} beside them is the part you chose yourself.");
    if (M.tokenCount >= 25) push("tickers_over_dollars", "chain", 6, "medium",
      { tickerCount: fmt.int(M.tokenCount), netWorth: fmt.usd(M.netWorth) }, {});
  }
  if (M.minHolders && M.minHolders.holders != null && M.minHolders.holders < 5000) {
    push("dead_holders", "chain", 9, "savage",
      { sym: M.minHolders.sym, holders: fmt.int(M.minHolders.holders), usd: fmt.usd(M.minHolders.usd) },
      { holders: M.minHolders.holders, sym: M.minHolders.sym });
  }
  const fakeMajor = M.priced.find((t) => t.fake_major);
  if (fakeMajor) push("fake_major", "chain", 10, "savage", { sym: fakeMajor.sym }, { holders: fakeMajor.holders });

  if (M.netWorth > 0) {
    if (M.top && M.top.usd / M.netWorth > 0.5) push("concentration", "chain", 6, "medium",
      { topPct: fmt.pct((M.top.usd / M.netWorth) * 100, 0), topSym: M.top.sym, netWorth: fmt.usd(M.netWorth) }, {});
    if (M.top && M.top.usd > 500 && M.top.mcap != null && M.top.mcap > 0 && M.top.mcap < TH.microMcap) {
      push("micro_top", "chain", 8, "savage",
        { topUsd: fmt.usd(M.top.usd), topMcap: fmt.usd(M.top.mcap), topSym: M.top.sym }, {});
    }
    const stableShare = M.netWorth > 0 ? M.stableUsd / M.netWorth : 0;
    if (M.netWorth > 500 && M.stableUsd < 1) push("no_stables", "chain", 7, "medium", { netWorth: fmt.usd(M.netWorth) }, {});
    else if (M.netWorth > 500 && stableShare < 0.02) push("stable_dust", "chain", 6, "gentle",
      { stableUsd: fmt.usd(M.stableUsd), netWorth: fmt.usd(M.netWorth) }, {});
  }

  /* ---- gas: real address-level gas, dollars converted at today's price */
  if (M.gasKnown && M.gasUsd > 1) {
    push("gas_burner_abs", "chain", 9, "savage",
      { gasUsd: fmt.usd(M.gasUsd), netWorth: fmt.usd(M.netWorth) }, { gasUsed: M.gasUsed, gasUsd: M.gasUsd, estimate: true });
    if (M.netWorth > 0) {
      const ratio = (M.gasUsd / Math.max(M.netWorth, 1)) * 100;
      if (ratio >= 5) push("gas_burner_pct", "chain", 10, "savage",
        { gasUsd: fmt.usd(M.gasUsd), gasPct: fmt.pct(ratio, 0), netWorth: fmt.usd(M.netWorth) }, { ratio });
    }
  }
  if (M.txCount >= 200) {
    const avg = M.netWorth / M.txCount;
    push("churn", "chain", 7, "medium",
      { txCount: fmt.int(M.txCount), netWorth: fmt.usd(M.netWorth), avgUsd: fmt.usd(avg) }, { txCount: M.txCount });
  } else if (M.txCount >= 30 && M.netWorth < 1000) {
    push("churn_lite", "chain", 5, "gentle", { txCount: fmt.int(M.txCount), netWorth: fmt.usd(M.netWorth) }, {});
  }
  if (M.loser) push("top_loser", "chain", 7, "medium",
    { sym: M.loser.t.sym, chg7: fmt.pct(Math.abs(M.loser.chg), 1), lossUsd: fmt.usd(Math.abs(M.loser.t.usd * M.loser.chg / 100)), netWorth: fmt.usd(M.netWorth) }, {});
  if (M.ethChg != null && M.netWorth > 0 && M.ethChg < -1) push("snapshot_vs_price", "chain", 4, "gentle",
    { netWorth: fmt.usd(M.netWorth), ethChg: fmt.pct(Math.abs(M.ethChg), 2) }, {});
  if (M.nft && M.nft.count >= 5) push("nft_dust", "chain", 6, "medium",
    { nftCount: fmt.int(M.nft.count), nftPriced: fmt.int(M.nft.priced || 0), nftFloor: fmt.usd(M.nft.floorUsd || 0) }, {});
  if (M.sol && M.sol.splSpam >= 1) push("sol_spam", "chain", 7, "medium",
    { solSpam: fmt.int(M.sol.splSpam), solUsd: fmt.usd(M.sol.usd) }, {},
    "{solSpam} SPL token accounts against {solUsd} of actual value. Solana hands out tokens the way conferences hand out lanyards.");

  /* ---- X behaviour */
  if (!X && input.handle) {
    push("x_unreadable", "x", 5, "medium", { handle: "@" + input.handle }, {},
      "We could not read {handle}, so the posting half of this receipt is explicitly unjudged. What follows is arithmetic, not guesswork.");
  } else if (!X) {
    push("no_x", "x", 4, "gentle", {}, {},
      "No X handle given, so the chain is judged alone. Judges do not need the defendant to speak.");
  } else {
    const perFollower = X.followers > 0 ? M.netWorth / X.followers : null;
    if (X.followers != null && X.tweets != null && X.tweets >= 50 && perFollower != null && M.netWorth > 0
        && X.followers <= 25000 && perFollower >= 0.5) {
      push("per_follower", "x", 7, "medium",
        { followers: fmt.int(X.followers), tweets: fmt.int(X.tweets), valuePerFollower: fmt.usd(perFollower) }, { perFollower });
    }
    if (X.following && X.followers != null && X.following > X.followers * 2 && X.following > 50) {
      push("ratio", "x", 8, "savage",
        { followers: fmt.int(X.followers), following: fmt.int(X.following), ratio: fmt.dec(X.following / Math.max(X.followers, 1), 1) }, {});
    }
    if (X.likes != null && X.tweets != null && X.tweets > 0) {
      const lpp = X.likes / X.tweets;
      if (lpp >= 5) push("engagement", "x", 8, "savage", { likes: fmt.int(X.likes), tweets: fmt.int(X.tweets), likesPerPost: fmt.dec(lpp, 1) }, {});
      else if (X.tweets >= 500 && lpp < 0.5) push("engagement_low", "x", 7, "medium", { tweets: fmt.int(X.tweets), likes: fmt.int(X.likes) }, {});
    }
    if (X.years != null && X.years >= 3 && X.tweets != null) {
      const ppd = X.tweets / (X.years * 365.25);
      if (ppd >= 8) push("firehose", "x", 9, "savage",
        { tweets: fmt.int(X.tweets), years: fmt.years(X.years), postsPerDay: fmt.dec(ppd, 1) }, { ppd });
      else if (ppd >= 2) push("posts_per_day", "x", 6, "medium",
        { postsPerDay: fmt.dec(ppd, 1), years: fmt.years(X.years), tweets: fmt.int(X.tweets) }, { ppd });
    }
    if (X.tweets != null && X.media != null && X.tweets >= 500 && X.media / Math.max(X.tweets, 1) < 0.05) {
      push("text_wall", "x", 7, "medium", { tweets: fmt.int(X.tweets), media: fmt.int(X.media) }, {});
    }
    if (X.years != null && X.years >= 5 && X.verified === false && X.followers < 5000) {
      push("not_verified", "x", 5, "medium", { years: fmt.years(X.years), followers: fmt.int(X.followers) }, {});
    }
    if (X.tweets === 0) push("ghost", "x", 9, "savage", { followers: fmt.int(X.followers), tweets: "0", years: fmt.years(X.years) }, {});
    const bio = (X.bio || "").toLowerCase();
    if (/dyor|nfa|not financial|wagmi|soon\b/.test(bio)) push("bio_dyor", "x", 7, "medium", { bio: '"' + String(X.bio).slice(0, 60).replace(/\s+/g, " ").trim() + '"' }, {});
    else if (/\bbuilder\b|\bfounder\b|\bceo\b|\bdev\b/.test(bio)) push("bio_builder", "x", 7, "medium", { bio: '"' + String(X.bio).slice(0, 60).replace(/\s+/g, " ").trim() + '"', followers: fmt.int(X.followers) }, {});
    else if (/degen|ape[sd]?\b|gambl/.test(bio)) push("bio_degen", "x", 6, "medium", { bio: '"' + String(X.bio).slice(0, 60).replace(/\s+/g, " ").trim() + '"' }, {});
    if (!X.bio || X.bio.trim().length < 3) push("bio_noob", "x", 5, "gentle", { tweets: fmt.int(X.tweets) }, {});
    else if ((X.bio.match(/[\/|·•]/g) || []).length >= 2) push("bio_copypaste", "x", 6, "medium", { bio: '"' + String(X.bio).split("\n")[0].slice(0, 50).trim() + '"' }, {});
    const hn = (X.handle.match(/\d{4}/) || [])[0];
    if (hn) push("handle_numbered", "x", 6, "medium", { handle: "@" + X.handle, handleNumber: hn }, {});
    if (X.handle.length >= 14) push("handle_long", "x", 4, "gentle", { handle: "@" + X.handle, handleLength: fmt.int(X.handle.length) }, {});
    if (X.years != null && X.years >= 8) push("joined_old", "x", 6, "medium", { years: fmt.years(X.years), followers: fmt.int(X.followers), tweets: fmt.int(X.tweets) }, {});
    if (X.name && /[\/|·•]|_|\b(hub|protocol|official|labs|capital|ventures|dao)\b/i.test(X.name)) {
      push("name_mismatch", "x", 6, "medium", { name: '"' + X.name.slice(0, 40) + '"', handle: "@" + X.handle }, {});
    }
    if (X.followers != null && X.followers > 0 && M.netWorth >= 0) {
      push("x_summary", "x", 2, "gentle", { followers: fmt.int(X.followers), tweets: fmt.int(X.tweets), years: fmt.years(X.years) }, {});
    }
  }

  /* ---- identity / OSINT */
  const ens = I.ens || { found: false };
  if (M.kind === "evm" && !ens.found) push("no_ens", "identity", 6, "medium", { addr: fmt.short(input.wallet) }, {},
    "No .eth name for {addr}. Your wallet has no name, which is consistent with having no alibi.");
  if (ens.found) {
    const len = ens.name.replace(/\.eth$/, "").length;
    if (len <= 3) push("ens_short", "identity", 6, "medium", { ens: ens.name, ensLen: fmt.int(len) }, {});
    else if (len >= 20) push("ens_long", "identity", 5, "gentle", { ens: ens.name, ensLen: fmt.int(len) }, {});
    const num = (ens.name.match(/\d{2,}/) || [])[0];
    if (num) push("ens_numbered", "identity", 5, "medium", { ens: ens.name, ensNumber: num }, {});
    const links = [ens.twitter, ens.github, ens.url].filter(Boolean).length;
    if (links === 0) push("ens_links_nothing", "identity", 4, "gentle", { ens: ens.name, linkCount: "0" }, {});
    if (ens.avatar && /metadata\.ens\.domains/.test(ens.avatar)) {
      const r = I.ensAvatarDefault;
      if (r === true) push("ens_avatar_default", "identity", 5, "gentle", { ens: ens.name }, {});
    }
  }
  if (I.github) push("linked_github", "identity", 6, "medium",
    { ghUser: I.github.login, ghRepos: fmt.int(I.github.repos), ghFollowers: fmt.int(I.github.followers) }, {});
  if (I.telegram && I.telegram.exists) push("linked_telegram", "identity", 5, "gentle", { tg: "@" + I.telegram.handle }, {},
    "There is a public Telegram at {tg}. It is the only thing here that answers messages.");
  if (X && X.handle && (I.github && I.github.login)) push("linked_x", "identity", 5, "gentle",
    { handle: "@" + X.handle, followers: fmt.int(X.followers) }, {});
  const plat = (I.platforms || []).filter((p) => p.found);
  if (plat.length >= 3) push("handle_squatted", "identity", 7, "medium",
    { handle: "@" + (input.handle || ""), platformCount: fmt.int(plat.length) }, { platforms: plat.map((p) => p.name) },
    "{handle} is registered on {platformCount} unrelated platforms. The handle is the only thing here with real distribution.");
  if (I.domain && I.domain.age_days != null && I.domain.age_days < 400) push("domain_old", "identity", 6, "medium",
    { domain: I.domain.host, domainAgeDays: fmt.int(I.domain.age_days) }, {});
  else if (I.domain && I.domain.resolves === false) push("domain_dead", "identity", 7, "medium", { domain: I.domain.host }, {});
  if (plat.length + (I.ens && I.ens.found ? 1 : 0) >= 2) push("public_exposure", "identity", 5, "medium",
    { exposureCount: fmt.int(plat.length + (I.ens && I.ens.found ? 1 : 0)), handle: "@" + (input.handle || "unknown") }, {},
    "{exposureCount} public traces tie {handle} to this wallet, and every one of them was voluntary.");

  /* weight order, then a family cap so one topic cannot own the receipt */
  const seen = {};
  return f.sort((a, b) => b.weight - a.weight)
    .filter((x) => { seen[x.family] = (seen[x.family] || 0) + 1; return seen[x.family] <= 3; });
}

/* ---------------------------------------------------------------- scoring */
function scoreFacts(M, X, I, facts) {
  const has = (id) => facts.some((x) => x.id === id);
  const comp = {};
  /* GAS: dollars burned in fees against what is actually left */
  if (M.gasKnown && M.gasUsd > 0) {
    comp.gas = clamp(M.netWorth > 0 ? (M.gasUsd / M.netWorth) * 100 : 100);
    if (M.gasUsd > M.netWorth) comp.gas = 100;
  } else comp.gas = null;
  /* DUST: share of the book that is unpriced or worth nothing */
  if (M.tokenCount > 0) {
    comp.dust = clamp(0.6 * (M.dustCount / M.tokenCount) * 100 + 0.4 * (M.unpricedCount / M.tokenCount) * 100);
    if (M.spamCount > 40) comp.dust = clamp(comp.dust + 15);
  } else comp.dust = 0;
  /* TASTE: what the money is parked in */
  let taste = 0;
  if (has("fake_major")) taste += 40;
  if (has("no_stables")) taste += 30;
  if (has("micro_top")) taste += 25;
  if (has("dead_holders")) taste += 20;
  if (has("stable_dust")) taste += 15;
  comp.taste = clamp(taste);
  /* CHURN: movement without arrival */
  comp.churn = clamp(0.7 * logScale(M.txCount + 1, 5000) + 0.3 * logScale(M.tokenTransfers + 1, 20000));
  /* VANITY: X behaviour. Absent when X could not be read, and the weight is then
     redistributed rather than faked. */
  if (X) {
    let v = 0;
    if (has("ratio")) v += 45;
    if (has("engagement")) v += 20;
    if (has("firehose")) v += 30;
    if (has("text_wall")) v += 15;
    if (has("not_verified")) v += 10;
    if (has("bio_builder") || has("bio_dyor")) v += 10;
    comp.vanity = clamp(v);
  } else comp.vanity = null;
  /* EXPOSURE: how easy the person is to place */
  let exp = 0;
  if (has("no_ens")) exp += 35;
  if (has("contract_wallet")) exp += 40;
  if (has("handle_squatted")) exp += 25;
  if (has("domain_dead")) exp += 20;
  if (has("linked_github")) exp += 10;
  comp.exposure = clamp(exp);
  /* LIQUIDITY: can any of this be sold */
  const zeroVol = M.priced.filter((t) => t.volume24h != null && t.volume24h < 100).length;
  comp.liquidity = clamp((M.priced.length ? (zeroVol / M.priced.length) * 100 : 0) * 0.6 + (M.unpricedCount > 50 ? 40 : 0));

  /* With no wallet there is no chain evidence: those components are unknown,
     not zero. The weight is redistributed and the receipt says so. */
  const basis = M.kind === "none" ? "x-only" : (X ? "chain+x" : "chain-only");
  if (M.kind === "none") { comp.dust = null; comp.gas = null; comp.taste = null; comp.churn = null; comp.liquidity = null; }
  else if (!X) { comp.vanity = null; }

  const known = SCORE_WEIGHTS.filter((s) => comp[s.key] != null);
  const wsum = known.reduce((a, s) => a + s.w, 0);
  let rekt = 0;
  for (const s of known) rekt += comp[s.key] * (s.w / wsum);
  const components = SCORE_WEIGHTS.map((s) => ({
    key: s.key, label: s.label, weight: +(comp[s.key] != null ? s.w / wsum : 0).toFixed(3),
    value: comp[s.key] == null ? null : Math.round(comp[s.key]),
  }));
  return { rekt: Math.round(clamp(rekt)), components, basis };
}

function levelFor(score) { return LEVELS.find((l) => score >= l.min) || LEVELS[LEVELS.length - 1]; }

/* ------------------------------------------------------------- archetype */
function classify(M, X, I, input) {
  const c = [];
  const add = (id, conf) => c.push({ id, conf });

  /* No wallet given: the subject is a posting record and the archetype has to say
     that instead of pretending a chain was read. */
  if (M.kind === "none") {
    if (!X) add("x_absent", 0.6);
    else if (X.tweets === 0) add("x_ghost", 0.85);
    else if (X.following > X.followers * 2) add("x_lurker", 0.75);
    else if (X.tweets / Math.max((X.years || 1) * 365.25, 1) > 6) add("x_broadcaster", 0.7);
    else if (X.name && /hub|protocol|official|labs|capital|dao|ventures/i.test(X.name)) add("x_brand_account", 0.65);
    else add("x_commentator", 0.5);
    return { id: c[0].id, conf: c[0].conf, candidates: c.slice(0, 4) };
  }
  const neverSent = M.kind === "evm" && M.chains.every((c) => (c.nonce || 0) === 0) && M.netWorth < 5;
  if (M.kind === "evm" && M.isContract) add("contract_entity", 0.95);
  if (neverSent) add("empty_wallet", 0.95);
  if (M.kind === "evm" && M.zeroActivity) add("empty_wallet", 0.9);
  if (X && X.tweets === 0) add("ghost_account", 0.75);
  const stableShare = M.netWorth > 0 ? M.stableUsd / M.netWorth : 0;
  if (stableShare > 0.9 && M.netWorth > 1000) add("stable_maxi", 0.8);
  if (M.netWorth >= TH.whale && stableShare < 0.02 && (M.top && M.top.mcap && M.top.mcap < 5e7)) add("whale_no_taste", 0.7);
  else if (M.netWorth >= 20000 && stableShare < 0.02) add("whale_no_taste", 0.6);
  if (M.txCount > 3000 && M.netWorth < 5000) add("degen_churner", 0.7);
  if (M.tokenCount >= 40 && M.dustCount / Math.max(M.tokenCount, 1) > 0.5) add("dust_collector", 0.75);
  if (M.tokenCount > 0 && M.tokenCount <= 12 && M.txCount < 60) add("silent_holder", 0.6);
  if (M.unpricedCount >= 20 && M.netWorth < 200) add("airship_hopeful", 0.55);
  if (M.top && M.top.usd / Math.max(M.netWorth, 1) > 0.8 && M.txCount > 20 && M.txCount < 200) add("vesting_survivor", 0.55);
  if (M.tokenCount > 30 && M.spamCount > 25 && M.txCount > 500 && M.netWorth < 5000) add("farming_bot", 0.5);
  if (M.nativeUsd < 5 && M.tokenUsd > 0 && M.txCount > 100) add("exit_liquidity", 0.5);
  if (!c.length) add("dust_collector", 0.4);
  c.sort((a, b) => b.conf - a.conf);
  return { id: c[0].id, conf: c[0].conf, candidates: c.slice(0, 4) };
}

/* --------------------------------------------------------- composition */
/* Sequencing rules (the comedy grammar, applied deterministically):
   1. open with the measured situation, so the receipt starts honest
   2. never two facts from the same family back to back
   3. keep the hardest hit for the position right before the verdict (the peak)
   4. escalation: if dust and unpriced are both present they print as a pair
   5. a maximum of seven lines: a receipt, not an essay
*/
function composeReceipt(facts, seed) {
  if (!facts.length) return [];
  const OPENERS = ["broke", "thin", "total_usd", "empty_address", "contract_wallet", "no_wallet", "sol_total"];
  const first = facts.find((f) => OPENERS.includes(f.id)) || facts[0];
  const rest = facts.filter((f) => f !== first);
  if (!rest.length) return [first];

  const peak = rest.slice().sort((a, b) => b.weight - a.weight)[0];
  const dust = rest.find((f) => f.id === "dust");
  const unpriced = rest.find((f) => f.id === "unpriced");
  const pair = dust && unpriced ? [dust, unpriced] : null;
  const taken = new Set([first, peak, ...(pair || [])].filter(Boolean));
  const middle = rest.filter((f) => !taken.has(f)).sort((a, b) => b.weight - a.weight);

  const seq = [];
  let prev = first.family;
  const pool = middle.slice();
  while (seq.length < 3 && pool.length) {
    const cand = pool.filter((f) => f.family !== prev);
    const next = (cand.length ? cand : pool)[0];
    seq.push(next); prev = next.family;
    pool.splice(pool.indexOf(next), 1);
  }
  const out = [first];
  if (pair) out.push(pair[0], pair[1]);
  out.push(...seq);
  if (peak && !(pair && pair.includes(peak))) out.push(peak);
  const seen = new Set();
  return out.filter((f) => (seen.has(f) ? false : (seen.add(f), true))).slice(0, 7);
}

/* ------------------------------------------------------- line selection */
/* Heat: 1 MILD reads like an accountant, 2 SPICY like a critic, 3 COOKED reaches for the
   hardest line the bank has for that fact. Nothing about the guardrails changes with heat:
   identity, family, faith, body and health are out at every setting, because that is not a
   sharper roast, it is a cheaper one. */
function allowedTiers(heat) {
  if (heat <= 1) return ["gentle", "medium"];
  if (heat === 2) return ["gentle", "medium", "savage"];
  return ["brutal", "savage", "medium", "gentle"];
}

function heatPool(list, heat, archetypeId) {
  if (!list.length) return [];
  const fits = archetypeId
    ? list.filter((v) => !v.archetypes || !v.archetypes.length || v.archetypes.includes(archetypeId))
    : list;
  const base = fits.length ? fits : list;
  const order = allowedTiers(heat);
  let pool = base.filter((v) => order.includes(v.tier || "medium"));
  if (!pool.length) pool = base;
  if (heat >= 3) {
    const hardest = order.find((t) => pool.some((v) => (v.tier || "medium") === t));
    const only = pool.filter((v) => (v.tier || "medium") === hardest);
    if (only.length) pool = only;
  }
  return pool;
}

function pickLine(bank, id, seed, archetypeId, heat) {
  const variants = (bank.byId && bank.byId[id]) || [];
  const pool = heatPool(variants, heat, archetypeId);
  if (!pool.length) return null;
  const r = rng(seed + id + heat + pool.length);
  const v = pool[Math.floor(r() * pool.length) % pool.length];
  return { text: v.text, device: v.device || null, tier: v.tier || "medium" };
}

function pickVerdictPool(bank, heat) {
  const all = (bank.verdicts && bank.verdicts.length) ? bank.verdicts : [{ text: "The numbers are public. The excuses are not on chain.", tier: "medium" }];
  const pool = heatPool(all, heat, null);
  return (pool.length ? pool : all).map((v) => v.text);
}

function archetypeLine(bank, id, heat, fallback) {
  const list = (bank.archetypeDesc && bank.archetypeDesc[id]) || [];
  const pool = heatPool(list, heat, null);
  if (!pool.length) return fallback;
  const r = rng("arch" + id + heat + pool.length);
  return pool[Math.floor(r() * pool.length) % pool.length].text;
}

/* What kind of thing the receipt is looking at, even when the joke bank has
   nothing for that fact. */
const DEFAULT_TAGS = { chain: "MEASURED", x: "PROFILE", identity: "RECORD" };

function fill(text, slots) {
  if (!slots) return text;
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (slots[k] != null ? slots[k] : m));
}

/* ------------------------------------------------------------- Jev pick */
/* One typed call, budgeted, and never load-bearing: if it does not answer in
   time the deterministic picks stand and the receipt says so. */
async function jevConsult(state, candidates, verdicts, key, model) {
  if (!key) return { used: false, reason: "no key configured" };
  const q = {
    archetype: {
      type: "choice",
      instructions: "Which single archetype best describes this wallet and account?",
      criteria: Object.fromEntries(candidates.map((c) => [c.id, c.id])),
    },
    verdict: {
      type: "choice",
      instructions: "Which closing line lands hardest as the final line of a roast receipt?",
      criteria: Object.fromEntries(verdicts.map((w, i) => ["v" + i, w])),
    },
  };
  const t0 = Date.now();
  try {
    const d = await getJSON("https://openrouter.ai/api/alpha/decisions", {
      ms: BUDGET.jev, method: "POST",
      headers: { Authorization: "Bearer " + key, "HTTP-Referer": "https://cooked.shojaee76.workers.dev", "X-Title": "cooked-receipt" },
      body: { state, model: model || "~typesafe/jev-latest", questions: q },
    });
    const a = (d && d.answers) || {};
    return {
      used: true, model: (d && d.model) || model, ms: Date.now() - t0,
      cost: (d && d.usage && d.usage.cost) || null,
      archetype: a.archetype ? a.archetype.choice : null,
      archetype_conf: a.archetype ? a.archetype.confidence : null,
      verdict_idx: a.verdict && a.verdict.choice ? Number(String(a.verdict.choice).replace("v", "")) : null,
      verdict_conf: a.verdict ? a.verdict.confidence : null,
    };
  } catch (e) {
    return { used: false, reason: String((e && e.message) || e).slice(0, 80), ms: Date.now() - t0 };
  }
}

/* --------------------------------------------------------------- the cook */
async function cook(input, opts = {}) {
  const t0 = Date.now();
  const heat = Math.min(3, Math.max(1, Number(input.heat) || 3));
  const seedBase = (input.wallet + "|" + input.handle + "|" + new Date().toISOString().slice(0, 10) + "|" + (input.salt || "") + "|h" + heat).toLowerCase();
  const r = rng(seedBase);

  const [x, ens] = await Promise.all([
    input.handle ? timed("fxtwitter", BUDGET.x, () => xProfile(input.handle)) : Promise.resolve(null),
    input.kind === "evm" ? timed("ens", BUDGET.ens, () => ensLookup(input.wallet)) : Promise.resolve(null),
  ]);

  /* --- chain reads, all in parallel, each source timed and recorded */
  let M = null, sol = null;
  if (input.kind === "evm") {
    const rpcRes = await Promise.all(CHAINS.map((c) =>
      timed(`rpc:${c.key}`, BUDGET.rpc, () => rpcBatch(c, input.wallet)).then((v) => ({ c, v }))));
    const native = await timed("prices:native", BUDGET.prices, nativePrices) || {};

    /* Counters, token lists and ethplorer race independently: a slow token list
       must never cost us the counters we already paid for. */
    const [countersRes, tokenRes, ethplorerRes] = await Promise.all([
      Promise.all(CHAINS.map((c) => timed(`counters:${c.key}`, BUDGET.blockscout, () => retry(() => blockscoutCounters(c, input.wallet)))
        .then((v) => [c.key, v]))),
      /* Retrying an explorer that rate-limits Cloudflare's own egress IPs just made the
         receipt slower (23.7s) without making it work. Two attempts, fixed budget, and a
         named source on the paper when it fails: honest beats slow. */
      Promise.all(CHAINS.map((c) => timed(`tokens:${c.key}`, BUDGET.blockscout, () => retry(() => blockscoutTokens(c, input.wallet), 2, 900))
        .then((v) => [c.key, v]))),
      timed("ethplorer", BUDGET.blockscout, () => retry(() => ethplorer(input.wallet), 2, 900)),
    ]);
    const counters = Object.fromEntries(countersRes.filter(([, v]) => v));

    const rows = rpcRes.filter((x2) => x2.v).map((x2) => {
      const cdef = x2.c;
      const price = native[cdef.cg] || null;
      const balance = Number(BigInt(x2.v.balanceWei)) / Math.pow(10, cdef.decimals);
      return { ...x2.v, balance, usd: price != null ? balance * price : null, nativePrice: price };
    });
    const tokensFound = tokenRes.filter(([, v]) => v && v.length).map(([key, v]) => {
      /* Ethereum: merge the explorer list with ethplorer's, which carries holder
         counts. When the explorer list is missing, ethplorer stands alone. */
      if (key === "eth" && ethplorerRes && ethplorerRes.tokens.length) {
        const byAddr = {};
        for (const t of ethplorerRes.tokens) byAddr[t.addr] = t;
        const merged = v.map((t) => {
          const e = byAddr[t.addr];
          if (!e) return t;
          delete byAddr[t.addr];
          return { ...t, holders: t.holders != null ? t.holders : e.holders,
            rate: t.rate != null ? t.rate : e.rate, usd: t.usd != null ? t.usd : e.usd };
        });
        const extra = Object.values(byAddr).filter((e) => !merged.some((m) => m.addr === e.addr));
        return { chain: key, tokens: [...merged, ...extra], counters: counters[key] || null };
      }
      return { chain: key, tokens: v, counters: counters[key] || null };
    });
    if (ethplorerRes && ethplorerRes.tokens && ethplorerRes.tokens.length
        && !tokensFound.some((t) => t.chain === "eth")) {
      tokensFound.push({ chain: "eth", tokens: ethplorerRes.tokens, counters: counters.eth || null });
    }

    /* token prices: one batched DefiLlama pass, but only over the contracts worth
       asking about. Spam tokens are counted, not priced. */
    const allTokens = tokensFound.flatMap((t) => t.tokens || []);
    const priceList = allTokens.filter((t) => t.addr && t.sym && t.sym !== "?")
      .sort((a, b) => (b.holders || 0) - (a.holders || 0)).slice(0, 150);
    const llama = await timed("defillama", BUDGET.llama, () => llamaPrices(priceList)) || {};
    for (const t of priceList) {
      const p = llama[t.addr];
      if (p == null) continue;
      /* When the explorer quoted its own price and DefiLlama disagrees by more
         than 5x, one of them is wrong about units. We keep the position but
         refuse to price it, rather than print a number we cannot defend. */
      if (t.rate0 > 0 && (p / t.rate0 > 5 || t.rate0 / p > 5)) { t.conflict = true; t.rate = null; t.usd = null; continue; }
      t.rate = p; t.usd = t.balance * p;
    }
    const elapsed = Date.now() - t0;
    const changes = elapsed < 7000
      ? (await timed("defillama:chg", BUDGET.llama, () => llamaChanges(priceList.filter((t) => t.usd != null).slice(0, 30))) || {})
      : {};

    const nft = Date.now() - t0 < 7000
      ? await timed("blockscout:nft", BUDGET.blockscout, () => blockscoutNfts(CHAINS[0], input.wallet))
      : null;
    M = measureChains(rows, tokensFound, { prices: native, changes, ethplorer: ethplorerRes });
    M.kind = "evm";
    M.nft = nft ? { count: nft.count, priced: 0, floorUsd: 0 } : null;
    M.ethplorer = ethplorerRes;
  } else if (input.kind === "solana") {
    const sol0 = await timed("solana", BUDGET.solana, () => solanaRead(input.wallet));
    const native = await timed("prices:native", BUDGET.prices, nativePrices) || {};
    const price = native[SOLANA.cg] || null;
    const bal = sol0 && sol0.lamports != null ? sol0.lamports / 1e9 : 0;
    const spl = (sol0 && sol0.spl) || [];
    M = {
      kind: "solana", chains: [], tokens: [], priced: [], spamTokens: [], unpriced: [], dust: [],
      nativeUsd: price ? bal * price : 0, tokenUsd: 0, netWorth: price ? bal * price : 0, spamUsd: 0,
      gasUsed: 0, gasUsd: 0, gasKnown: false, txCount: 0, tokenTransfers: 0,
      tokenCount: spl.length, dustCount: 0, unpricedCount: spl.length, spamCount: 0, chainsActive: 1,
      top: null, minHolders: null, loser: null, isContract: false, delegate: null, zeroActivity: bal === 0 && spl.length === 0,
      prices: native, ethChg: null,
      sol: { balance: bal, usd: price ? bal * price : 0, splCount: spl.length, splSpam: spl.filter((s) => s.amount > 0).length, usdToken: 0 },
    };
    sol = M.sol;
  } else {
    M = {
      kind: "none", chains: [], tokens: [], priced: [], spamTokens: [], unpriced: [], dust: [],
      nativeUsd: 0, tokenUsd: 0, netWorth: 0, spamUsd: 0, gasUsed: 0, gasUsd: 0, gasKnown: false,
      txCount: 0, tokenTransfers: 0, tokenCount: 0, dustCount: 0, unpricedCount: 0, spamCount: 0,
      chainsActive: 0, top: null, minHolders: null, loser: null,
      isContract: false, delegate: null, zeroActivity: false, prices: {}, ethChg: null,
    };
  }

  /* --- OSINT footprint (public pages only) */
  const I = { ens: ens || { found: false }, platforms: [], github: null, telegram: null, farcaster: null, domain: null };
  if (input.handle || (ens && ens.github)) {
    const probes = [];
    if (input.handle) for (const p of OSINT_PLATFORMS) probes.push(platformProbe(p, input.handle));
    else probes.push(Promise.resolve({ name: "github", found: false }));
    const res = await timed("osint:platforms", BUDGET.osint, () => Promise.all(probes));
    I.platforms = (res || []).filter(Boolean);
    const ghLogin = (ens && ens.github) || (input.handle && (I.platforms.find((p) => p.name === "github" && p.found) ? input.handle : null));
    if (ghLogin) I.github = await timed("github:user", BUDGET.osint, () => githubUser(ghLogin));
    const tg = I.platforms.find((p) => p.name === "telegram" && p.found);
    if (tg) I.telegram = { handle: input.handle, exists: true };
    const fc = I.platforms.find((p) => p.name === "warpcast" && p.found);
    if (fc) I.farcaster = { username: input.handle, ...(fc.detail || {}) };
    const url = (x && x.website) || (ens && ens.url) || null;
    if (url) I.domain = await timed("domain:recon", 9000, () => domainRecon(url));
  }

  /* --- facts, score, archetype, receipt */
  const facts = buildFacts(M, x, I, input);
  const { rekt, components, basis } = scoreFacts(M, x, I, facts);
  const arch = classify(M, x, I, input);
  const bank = opts.bank || { byId: {} };
  const verdicts = pickVerdictPool(bank, heat);
  const seed = seedBase;

  const printed = composeReceipt(facts, seed).map((f) => {
    const line = pickLine(bank, f.id, seed, arch.id, heat);
    const raw = line ? line.text : (f.fb || "");
    const text = fill(raw, f.slots);
    if (!text || /\{\w+\}/.test(text)) return null;   /* an unfilled slot is a lie, so the line is dropped */
    return { ...f, text, device: line ? line.device : null, tier: line ? line.tier : f.tier,
      tag: (bank.tags && bank.tags[f.id]) || DEFAULT_TAGS[f.family] || "MEASURED" };
  }).filter(Boolean);

  const verdictIdx = Math.floor(r() * verdicts.length) % verdicts.length;
  const jev = await jevConsult(
    describeForJev(M, x, arch, printed),
    arch.candidates, verdicts.slice(0, 8), opts.jevKey, opts.jevModel);

  let archetypeId = arch.id;
  if (jev.used && jev.archetype && arch.candidates.some((c) => c.id === jev.archetype) && (jev.archetype_conf || 0) > 0.5) {
    archetypeId = jev.archetype;
  }
  const finalVerdictIdx = (jev.used && jev.verdict_idx != null && verdicts[jev.verdict_idx])
    ? jev.verdict_idx : verdictIdx;

  const missing = _cov.filter((c) => !c.ok).map((c) => c.source);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    ms: Date.now() - t0,
    input: { handle: input.handle || null, wallet: input.wallet || null, kind: input.kind, heat },
    subject: {
      label: input.handle ? "@" + (x ? x.handle : input.handle) : (I.ens && I.ens.found ? I.ens.name : fmt.short(input.wallet || "")),
      avatar: (x && x.avatar) || (I.ens && I.ens.avatar) || null,
      ens: I.ens && I.ens.found ? I.ens.name : null,
      name: (x && x.name) || (I.github && I.github.name) || null,
    },
    x,
    chain: {
      kind: M.kind,
      net_worth_usd: M.netWorth, spam_usd: M.spamUsd, eth_price: (M.prices || {}).ethereum || null,
      tokens: M.priced.slice(0, 40),
      dust_count: M.dustCount, unpriced_count: M.unpricedCount, token_count: M.tokenCount,
      fake_token_count: M.priced.filter((t) => t.fake_major).length + M.spamCount,
      gas_used: M.gasUsed, gas_usd: M.gasUsd, tx_count: M.txCount, token_transfers: M.tokenTransfers,
      chains: M.chains,
      sol: sol,
    },
    identity: I,
    facts,
    receipt: printed,
    score: { rekt, level: levelFor(rekt).name, note: levelFor(rekt).note, components, basis },
    archetype: { id: archetypeId, name: archetypeId.replace(/_/g, " ").toUpperCase(),
      desc: archetypeLine(bank, archetypeId, heat, ARCHETYPES[archetypeId] || ARCHETYPES.dust_collector),
      conf: arch.conf, candidates: arch.candidates },
    heat: { level: heat, label: heat >= 3 ? "COOKED" : heat === 2 ? "SPICY" : "MILD" },
    jev: { used: jev.used, model: jev.model || null, ms: jev.ms || null, cost: jev.cost != null ? jev.cost : null, reason: jev.reason || null, verdict_conf: jev.verdict_conf != null ? jev.verdict_conf : null },
    coverage: _cov.slice(),   /* snapshot: the live array is reused per request and cached copies must not alias it */
    data_truth: {
      complete: missing.length === 0,
      missing,
      note: missing.length === 0 ? "Every source answered." : `No answer from: ${missing.join(", ")}. Facts that needed them were left off the receipt rather than guessed.`,
    },
    verdict: verdicts[finalVerdictIdx],
  };
}

function describeForJev(M, X, arch, printed) {
  const bits = [
    M.kind === "evm" ? `on-chain value ${fmt.usd(M.netWorth)} across ${M.chainsActive} chains` : `solana subject, ${fmt.usd(M.netWorth)}`,
    `${M.tokenCount} tokens, ${M.unpricedCount} unpriced, ${M.spamCount} spam`,
    M.gasKnown ? `lifetime gas ${fmt.usd(M.gasUsd)} with ${M.netWorth > 0 ? (M.gasUsd / M.netWorth * 100).toFixed(0) : "99"}% of that destroyed in fees` : "",
    M.txCount ? `${M.txCount} transactions seen` : "",
    M.top ? `largest position ${M.top.sym} at ${fmt.usd(M.top.usd)}` : "",
    X ? `X account @${X.handle}, ${X.followers} followers, ${X.tweets} posts, ${X.following} following, joined ${X.joined}` : "no X account read",
    printed.length ? `facts printed: ${printed.map((p) => p.text).join(" | ").slice(0, 700)}` : "",
  ].filter(Boolean);
  return "Wallet roast subject. " + bits.join(". ") + ".";
}
