/* ============================================================================
   COOKED — data layer. Every function records its own coverage entry so the
   receipt can print exactly which machines answered and which ones did not.
   Nothing here invents data: a failed source returns null and says why.
   ========================================================================== */

const _cov = [];
function cov(source, ok, ms, extra) {
  const e = { source, ok: !!ok, ms: Math.round(ms) };
  if (extra && extra.error) e.error = String(extra.error).slice(0, 120);
  if (extra && extra.note) e.note = String(extra.note).slice(0, 120);
  _cov.push(e);
  return ok;
}

async function timed(source, ms, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    cov(source, true, Date.now() - t0);
    return r;
  } catch (err) {
    cov(source, false, Date.now() - t0, { error: (err && err.message) || String(err) });
    return null;
  }
}

async function retry(fn, times = 2, delay = 900) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(); }
    catch (e) { last = e; if (i < times - 1) await new Promise((r) => setTimeout(r, delay * (i + 1))); }
  }
  throw last;
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(label ? `${label} timeout` : "timeout")), ms);
    }),
  ]);
}

async function getJSON(url, { ms = 8000, headers = {}, method = "GET", body = null } = {}) {
  const h = { "User-Agent": UA, Accept: "application/json", ...headers };
  if (body) h["Content-Type"] = "application/json";
  const res = await withTimeout(fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined }),
    ms, new URL(url).hostname);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const txt = await res.text();
  if (!txt) throw new Error("empty body");
  try { return JSON.parse(txt); } catch (e) { throw new Error("bad json"); }
}

async function getText(url, { ms = 8000, headers = {} } = {}) {
  const res = await withTimeout(fetch(url, { headers: { "User-Agent": UA, ...headers } }), ms, new URL(url).hostname);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

/* ---------------------------------------------------------------- chain RPC */

/* One JSON-RPC batch per chain: balance + nonce + code (+ gas price on eth-like).
   Five chains cost five requests instead of twenty, which is the whole point. */
async function rpcBatch(chain, address) {
  const calls = [
    { jsonrpc: "2.0", id: "bal",   method: "eth_getBalance",            params: [address, "latest"] },
    { jsonrpc: "2.0", id: "nonce", method: "eth_getTransactionCount",   params: [address, "latest"] },
    { jsonrpc: "2.0", id: "code",  method: "eth_getCode",               params: [address, "latest"] },
    { jsonrpc: "2.0", id: "gas",   method: "eth_gasPrice",              params: [] },
    { jsonrpc: "2.0", id: "blk",   method: "eth_blockNumber",           params: [] },
  ];
  let lastErr = null;
  for (const url of chain.rpc) {
    try {
      const out = await getJSON(url, { ms: BUDGET.rpc, method: "POST", body: calls });
      const m = {};
      for (const row of out) m[row.id] = row.result;
      if (m.bal == null) throw new Error("no balance in batch reply");
      return {
        chain: chain.key, rpc: new URL(url).hostname,
        balanceWei: String(m.bal), nonce: m.nonce ? Number(BigInt(m.nonce)) : 0,
        code: m.code || "0x", gasPriceWei: m.gas ? Number(BigInt(m.gas)) : null,
        block: m.blk ? Number(BigInt(m.blk)) : null,
      };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no rpc answered");
}

/* Blockscout (keyless) gives real per-address counters: transaction count and total gas
   burned by that address. That is measured data, not a nonce-times-guess estimate. */
async function blockscoutCounters(chain, address) {
  if (!chain.bs) return null;
  const d = await getJSON(`${chain.bs}/api/v2/addresses/${address}/counters`, { ms: BUDGET.blockscout });
  return {
    tx_count: Number(d.transactions_count || 0),
    token_transfers: Number(d.token_transfers_count || 0),
    gas_used: Number(d.gas_usage_count || 0),
  };
}

async function blockscoutTokens(chain, address) {
  if (!chain.bs) return null;
  const arr = await getJSON(`${chain.bs}/api/v2/addresses/${address}/token-balances`, { ms: BUDGET.blockscout });
  if (!Array.isArray(arr)) throw new Error("unexpected shape");
  return arr.slice(0, 400).map((e) => {
    const t = e.token || {};
    const dec = Number(t.decimals || 18);
    const raw = e.value || "0";
    const bal = Number(raw) / Math.pow(10, dec);
    const rate = t.exchange_rate ? Number(t.exchange_rate) : null;
    return {
      chain: chain.key, addr: (t.address_hash || t.address || "").toLowerCase(),
      sym: t.symbol || "?", name: t.name || "", balance: bal,
      holders: t.holders_count ? Number(t.holders_count) : null,
      rate, rate0: rate, usd: rate != null && isFinite(bal) ? bal * rate : null,
      mcap: t.circulating_market_cap ? Number(t.circulating_market_cap) : null,
      volume24h: t.volume_24h ? Number(t.volume_24h) : null,
      type: t.type || "ERC-20",
    };
  });
}

async function blockscoutNfts(chain, address) {
  if (!chain.bs) return null;
  const d = await getJSON(`${chain.bs}/api/v2/addresses/${address}/nft?type=ERC-721%2CERC-404%2CERC-1155`, { ms: BUDGET.blockscout });
  return { count: (d.items || []).length, has_more: !!d.next_page_params };
}

/* Ethplorer's freekey tier is the only ETH token source that also carries holderCount. */
async function ethplorer(address) {
  const d = await getJSON(`https://api.ethplorer.io/getAddressInfo/${address}?apiKey=freekey&showZeroBalance=false`, { ms: BUDGET.blockscout });
  const ethPrice = d.ETH && d.ETH.price ? Number(d.ETH.price.rate) : null;
  const ethChg = d.ETH && d.ETH.price && d.ETH.price.diff != null ? Number(d.ETH.price.diff) : null;
  const tokens = (d.tokens || []).map((e) => {
    const ti = e.tokenInfo || {};
    const dec = Number(ti.decimals || 18);
    const bal = Number(e.balance || 0) / Math.pow(10, dec);
    const rate = ti.price && ti.price.rate ? Number(ti.price.rate) : null;
    return {
      chain: "eth", addr: (ti.address || "").toLowerCase(), sym: ti.symbol || "?", name: ti.name || "",
      balance: bal, holders: ti.holdersCount ? Number(ti.holdersCount) : null, rate, rate0: rate,
      usd: rate != null ? bal * rate : null, mcap: ti.marketCapUsd ? Number(ti.marketCapUsd) : null,
      volume24h: ti.volume24h ? Number(ti.volume24h) : null, type: "ERC-20",
    };
  });
  tokens.sort((a, b) => (b.usd || 0) - (a.usd || 0));
  return { ethPrice, ethChg, tokens: tokens.slice(0, 300), is_contract: !!(d.contractInfo && d.contractInfo.creatorAddress) };
}

/* ------------------------------------------------------------------ prices */

async function nativePrices() {
  const ids = [...new Set(CHAINS.map((c) => c.cg))].join(",") + "," + SOLANA.cg;
  const KEY = { ethereum: "ETHUSDT", binancecoin: "BNBUSDT", "matic-network": "POLUSDT", solana: "SOLUSDT" };
  const out = {};
  const want = ids.split(",");

  /* 1. DefiLlama: keyless, generous, answers from this line. A missing price used
     to zero the whole net worth, which is exactly how a receipt starts lying. */
  try {
    const d = await getJSON(`https://coins.llama.fi/prices/current/${want.map((i) => "coingecko:" + i).join(",")}`,
      { ms: BUDGET.prices });
    for (const [k, v] of Object.entries((d && d.coins) || {})) {
      if (v && v.price != null) out[k.replace("coingecko:", "")] = Number(v.price);
    }
  } catch (e) {}

  /* 2. Exchange tickers for whatever is still missing. */
  const missing = want.filter((i) => out[i] == null && KEY[i]);
  if (missing.length) {
    const quotes = await Promise.all(missing.map((id) =>
      getJSON(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${KEY[id]}`, { ms: 5000 })
        .then((d) => { const row = d && d.result && d.result.list && d.result.list[0]; return [id, row ? Number(row.lastPrice) : null]; })
        .catch(() => [id, null])));
    for (const [id, p] of quotes) if (p) out[id] = p;
  }

  /* 3. CoinGecko last, because it rate limits under load. */
  const still = want.filter((i) => out[i] == null);
  if (still.length) {
    try {
      const d = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${still.join(",")}&vs_currencies=usd`, { ms: BUDGET.prices });
      for (const [id, v] of Object.entries(d || {})) if (v && v.usd != null) out[id] = Number(v.usd);
    } catch (e) {}
  }
  return out;
}

/* One DefiLlama call prices every token contract we found, on every chain. */
async function llamaPrices(tokens) {
  const keys = tokens.filter((t) => t.addr && t.addr.startsWith("0x"))
    .map((t) => `${chainLlama(t.chain)}:${t.addr.toLowerCase()}`);
  const uniq = [...new Set(keys)];
  if (!uniq.length) return {};
  const out = {};
  const batches = [];
  for (let i = 0; i < uniq.length && batches.length < 3; i += 80) batches.push(uniq.slice(i, i + 80));
  const results = await Promise.all(batches.map((b) =>
    getJSON(`https://coins.llama.fi/prices/current/${b.join(",")}`, { ms: BUDGET.llama }).catch(() => null)));
  for (const d of results) {
    for (const [k, v] of Object.entries((d && d.coins) || {})) {
      if (v && v.price != null) out[k.split(":")[1].toLowerCase()] = Number(v.price);
    }
  }
  return out;
}

/* 7-day change per token, used for the one genuinely funny market fact. */
async function llamaChanges(tokens) {
  const keys = tokens.filter((t) => t.addr).map((t) => `${chainLlama(t.chain)}:${t.addr.toLowerCase()}`);
  const uniq = [...new Set(keys)].slice(0, 60);
  if (!uniq.length) return {};
  const out = {};
  try {
    const d = await getJSON(`https://coins.llama.fi/percentage/${uniq.join(",")}`, { ms: BUDGET.llama });
    for (const [k, v] of Object.entries((d && d.coins) || {})) {
      const ch = v && (v["7d"] != null ? v["7d"] : v["24h"]);
      if (ch != null) out[k.split(":")[1].toLowerCase()] = Number(ch);
    }
  } catch (e) { /* optional enrichment; absence is honest */ }
  return out;
}

function chainLlama(key) {
  const c = CHAINS.find((x) => x.key === key);
  return c ? c.llama : key;
}

/* --------------------------------------------------------------- X profile */

/* fxtwitter is public and keyless, and it still returns the joined date, which the
   official API charges for. Counts are the account's public counters. */
async function xProfile(handle) {
  let d = null;
  for (let attempt = 0; attempt < 2 && !d; attempt++) {
    try {
      d = await getJSON(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`, { ms: BUDGET.x });
    } catch (e) {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
      else throw e;
    }
  }
  const u = d && d.user;
  if (!u || !u.screen_name) throw new Error("no profile");
  let joined = null, years = null;
  if (u.joined) {
    const dt = new Date(u.joined);
    if (!isNaN(dt)) {
      joined = dt.toISOString().slice(0, 10);
      years = +(((Date.now() - dt.getTime()) / 31557600000).toFixed(1));
    }
  }
  return {
    handle: u.screen_name, name: u.name || "", bio: u.description || "", avatar: u.avatar_url || null,
    banner: u.banner_url || null, followers: num(u.followers), following: num(u.following),
    tweets: num(u.tweets), likes: num(u.likes), media: num(u.media_count),
    joined, years, verified: !!(u.verification && u.verification.verified),
    protected: !!u.protected, location: u.location || null, website: u.website ? (u.website.display_url || u.website.url || null) : null,
    source: "fxtwitter",
  };
}

function num(v) { return v == null ? null : Number(v); }

/* ------------------------------------------------------------------ OSINT */

async function ensLookup(address) {
  const d = await getJSON(`https://api.ensideas.com/ens/resolve/${address}`, { ms: BUDGET.ens });
  if (!d || !d.name) return { found: false };
  return {
    found: true, name: d.name, address: d.address,
    avatar: d.avatar || null, displayName: d.displayName || d.name,
    twitter: d.twitter || null, github: d.github || null, url: d.url || null,
  };
}

/* GitHub profile of a handle we found in a bio, an ENS record or the X handle itself. */
async function githubUser(login) {
  const d = await getJSON(`https://api.github.com/users/${encodeURIComponent(login)}`,
    { ms: BUDGET.osint, headers: { Accept: "application/vnd.github+json" } });
  if (!d || !d.login) throw new Error("not found");
  return {
    login: d.login, name: d.name || null, repos: num(d.public_repos), followers: num(d.followers),
    created: d.created_at ? String(d.created_at).slice(0, 10) : null, bio: d.bio || null, avatar: d.avatar_url || null,
  };
}

/* Public handle footprint. Each probe answers "does this page exist as a public profile".
   No login walls, no signup endpoints, nothing that would count as account enumeration. */
async function platformProbe(p, handle) {
  try {
    const r = await getText(p.api(handle), { ms: BUDGET.osint });
    let found = false, detail = null;
    if (p.name === "github") found = r.status === 200;
    else if (p.name === "telegram") found = r.status === 200 && /tgme_page|Telegram: Contact/i.test(r.text);
    else if (p.name === "keybase") found = r.status === 200 && /"them":\s*\[\{/.test(r.text.replace(/\s+/g, " "));
    else if (p.name === "devto") found = r.status === 200 && /"username"/.test(r.text);
    else if (p.name === "gitlab") found = r.status === 200 && r.text.trim() !== "[]";
    else if (p.name === "linktree") found = r.status === 200 && /"username"/.test(r.text);
    else if (p.name === "warpcast") found = r.status === 200 && /"username"/.test(r.text);
    if (found && detail == null) {
      try { const j = JSON.parse(r.text); detail = summarizePlatform(p.name, j); } catch (e) {}
    }
    return { name: p.name, url: p.url(handle), found, status: r.status, detail };
  } catch (e) {
    return { name: p.name, url: p.url(handle), found: false, error: String(e.message || e).slice(0, 60) };
  }
}

function summarizePlatform(name, j) {
  try {
    if (name === "warpcast") { const u = j.result && j.result.user; return u ? { fid: u.fid, followers: u.followerCount, display: u.displayName } : null; }
    if (name === "github") return { repos: j.public_repos, followers: j.followers, created: String(j.created_at || "").slice(0, 10) };
    if (name === "gitlab") return Array.isArray(j) && j[0] ? { name: j[0].name, created: String(j[0].created_at || "").slice(0, 10) } : null;
  } catch (e) {}
  return null;
}

/* Domain in a bio: is it alive, and how old is it? RDAP is the official registry answer. */
async function domainRecon(host) {
  const clean = String(host).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) return null;
  const out = { host: clean, resolves: false, created: null, age_days: null, server: null };
  try {
    const dns = await getJSON(`https://dns.google/resolve?name=${clean}&type=A`, { ms: 5000 });
    out.resolves = !!(dns && dns.Answer && dns.Answer.length);
  } catch (e) {}
  try {
    const rdap = await getJSON(`https://rdap.org/domain/${clean}`, { ms: 6000 });
    const ev = (rdap.events || []).find((e) => e.eventAction === "registration");
    if (ev && ev.eventDate) {
      out.created = String(ev.eventDate).slice(0, 10);
      out.age_days = Math.round((Date.now() - new Date(ev.eventDate).getTime()) / 86400000);
    }
  } catch (e) {}
  try {
    const r = await getText(`https://${clean}`, { ms: 6000 });
    out.server = r.headers.get("server") || null;
    if (r.status >= 400) out.resolves = false;
  } catch (e) {}
  return out;
}

/* ---------------------------------------------------------------- solana */

async function solanaRead(address) {
  const rpc = SOLANA.rpc[0];
  const bal = await getJSON(rpc, {
    ms: BUDGET.solana, method: "POST",
    body: { jsonrpc: "2.0", id: "bal", method: "getBalance", params: [address] },
  });
  const lamports = bal && bal.result ? bal.result.value : null;
  let spl = [];
  try {
    const ta = await getJSON(rpc, {
      ms: BUDGET.solana, method: "POST",
      body: { jsonrpc: "2.0", id: "tok", method: "getTokenAccountsByOwner",
        params: [address, { programId: SOLANA.splToken }, { encoding: "jsonParsed" }] },
    });
    spl = ((ta.result && ta.result.value) || []).map((a) => {
      const info = a.account && a.account.data && a.account.data.parsed && a.account.data.parsed.info;
      if (!info) return null;
      const amt = info.tokenAmount || {};
      return { mint: info.mint, amount: Number(amt.uiAmount || 0), decimals: amt.decimals };
    }).filter(Boolean);
  } catch (e) { /* SPL list is optional */ }
  return { lamports, spl };
}
