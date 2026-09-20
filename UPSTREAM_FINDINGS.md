# UPSTREAM FINDINGS: roast-my-bag

I built a competing version of this exact product (COOKED) and used your site as the benchmark,
which meant probing your live API hard. Ten things came out of that worth fixing. Everything below
has a copy-paste repro you can run against your own worker right now, plus a minimal fix.

All repros were executed on 2026-09-20 against the live worker. JSON blocks are real responses,
trimmed only where marked. Latencies are measured from my network line, so treat them as
order-of-magnitude for what your Worker sees from Cloudflare egress.

The short version: the comedy layer is genuinely good. The data layer under it regularly states
things that are not true, and users notice that kind of lie in seconds because they check the
address on an explorer. Every fix below is about making the numbers defensible, which also
protects the jokes.

## TL;DR

| # | Finding | Severity |
|---|---------|----------|
| 1 | Handle-only requests get the on-chain `empty_wallet` archetype and REKT 92-93 | High |
| 2 | `partial: false` while `ethplorer: false, blockscout: false`, receipt still says NET WORTH ON-CHAIN | High |
| 3 | Hundreds of spam and `?`-symbol tokens counted as holdings; unpriced count includes airdrop junk | High |
| 4 | `gas_burner_abs` missing from the client TAGS map, so the line renders with the fallback tag FACT | Low |
| 5 | No rate limit, no cache, no budget: every call is an upstream RPC fan-out plus a paid Jev call | High |
| 6 | Brand implies a $ROAST token exists: no mint address, no disclaimer | Medium |
| 7 | Prices from a single source with no cross-check; one source outage zeroes a whole net worth | Medium |
| 8 | Decimals artifacts: raw-unit balances priced as real. Fix with cross-checks, not clamping | High |
| 9 | No contract vs person distinction; EIP-7702 delegated EOAs are the trap either direction | Medium |
| 10 | Per-source timeouts not isolated: one slow token list discards counters already fetched | Medium |

## 1. Handle-only requests get an on-chain archetype and a REKT score

**What shipped.** With an X handle and no wallet, the response still carries `archetype:
"empty_wallet"` and a REKT in the 90s, and `partial: false` as if a complete read had happened.

**Repro.**

```bash
curl -s -X POST https://roast-mybag.mtayebi1997.workers.dev/api/roast \
  -H 'Content-Type: application/json' \
  -d '{"x":"elonmusk"}'
```

Real response, trimmed:

```json
{
  "x": { "handle": "elonmusk", "followers": 241669828, "tweets": 108815, "joined_ts": 1243973549 },
  "wallet": { "_error": "bad address" },
  "has_wallet": false,
  "tokens": [],
  "fake_token_count": 0,
  "archetype": "empty_wallet",
  "archetype_desc": "Zero on-chain. Talks about the market constantly and has never put a dollar in it.",
  "rekt": 92,
  "partial": false,
  "coverage": null
}
```

First run of the same request returned `rekt: 93`, later runs 92: the score moves because the Jev
`ngmi` output (0.69 to 0.70) feeds it. Note `coverage: null` on this path, so the client cannot
even show which sources were skipped.

**Why it matters.** `empty_wallet` is an on-chain claim ("Zero on-chain") for a subject whose
chain was never read. Anyone who knows the subject has a wallet sees the lie immediately, and it
poisons every other number on the receipt. A handle-only subject is a different product, not a
degraded one.

**Minimal fix.** Branch on `has_wallet` before archetype selection: use a posting-record archetype
set, drop every chain-derived fact, and label the score basis. COOKED does it like this
(`src/30_engine.js`, verbatim):

```js
if (M.kind === "none") {
    if (!X) add("x_absent", 0.6);
    else if (X.tweets === 0) add("x_ghost", 0.85);
    else if (X.following > X.followers * 2) add("x_lurker", 0.75);
    else if (X.tweets / Math.max((X.years || 1) * 365.25, 1) > 6) add("x_broadcaster", 0.7);
    else if (X.name && /hub|protocol|official|labs|capital|dao|ventures/i.test(X.name)) add("x_brand_account", 0.65);
    else add("x_commentator", 0.5);
    return { id: c[0].id, conf: c[0].conf, candidates: c.slice(0, 4) };
}
```

and the score carries the basis so the client can print it:

```js
const basis = M.kind === "none" ? "x-only" : (X ? "chain+x" : "chain-only");
```

One printed "NO WALLET ON FILE" line plus X-only facts makes a receipt that is fully funny and fully true.

## 2. `partial: false` while two of three token sources are down

**What shipped.** The coverage object honestly reports failures, but `partial` stays `false`, and
the receipt labels the total NET WORTH ON-CHAIN regardless.

**Repro.**

```bash
curl -s -X POST https://roast-mybag.mtayebi1997.workers.dev/api/roast \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"0x28C6c06298d514Db089934071355E5743bf21d60"}'
```

Observed on 2026-09-20 (Binance hot wallet):

```json
{
  "coverage": { "ethplorer": false, "alchemy": true, "blockscout": false },
  "partial": false,
  "wallet": { "total_usd": 2301094630.78, "networth_partial": false }
}
```

Meanwhile your page source labels the total like this (verbatim from the shipped HTML):

```js
${d.partial ? "VISIBLE VALUE (LOWER BOUND)" : "NET WORTH ON-CHAIN"}
```

So a $2.30B figure prints under NET WORTH ON-CHAIN on a run where both ethplorer and Blockscout
failed. On repeated runs the same address flapped between `blockscout: true` and
`blockscout: false`, so the label correctness depends on which minute you hit the endpoint.

**Why it matters.** The whole value of the receipt metaphor is that the paper is auditable. A
total computed while two token sources were down is a lower bound, and the one word that would
say so is currently unreachable.

**Minimal fix.** Derive `partial` from the source flags instead of hardcoding it: if any token
source failed, `partial: true`. Better, print a SOURCES block so the reader sees the audit trail.
COOKED computes it from per-source coverage entries and asserts on it in the harness:

```js
const missing = _cov.filter((c) => !c.ok).map((c) => c.source);
// ...
data_truth: {
  complete: missing.length === 0,
  missing,
  note: missing.length === 0 ? "Every source answered."
    : `No answer from: ${missing.join(", ")}. Facts that needed them were left off the receipt rather than guessed.`,
},
```

## 3. Spam and `?`-symbol tokens counted as holdings

**What shipped.** `fake_token_count` reports hundreds of junk tokens as part of the bag, the
unpriced count includes pure airdrop junk, and the printed token list is capped at 12 rows so the
counts and the list contradict each other with no explanation.

**Repro.**

```bash
curl -s -X POST https://roast-mybag.mtayebi1997.workers.dev/api/roast \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"}'
```

Observed for vitalik.eth: `fake_token_count: 485` on one run, 534 on another. The unpriced line
prints: "378 of your tokens have no price. Not low cap. No price. Nothing is bidding." The
`dead_holders` line prints: "You hold GENE with 4 holders total." And `tokens` in the same
response has exactly 12 entries.

**Why it matters.** Junk tokens are a scam someone airdropped at the address, not a holding the
subject chose. Counting them as "485 tokens in the bag" tells the reader a falsehood about the
person, and the 12-against-485 mismatch looks like a bug to anyone who checks.

**Minimal fix.** Classify with holders plus value, count spam separately, and never mix it into
holdings or net worth. COOKED's classifier (`src/30_engine.js`, verbatim), driven by thresholds in
config (`spamHolders: 30, spamUsd: 5`):

```js
const spam = (!priced && holders != null && holders < TH.spamHolders) ||
             (priced && usd < TH.spamUsd && holders != null && holders < TH.spamHolders) ||
             (sym === "?" && (usd == null || usd < 1));
```

A token with 4 holders is not "a dead bag entry", it is litter someone sent. That distinction is
also funnier: "349 of these are airdropped junk somebody hoped you would trade" beats a wrong
token count. If the printed list is capped at 12 rows, print "showing 12 of N" so the numbers
reconcile.

## 4. `gas_burner_abs` renders with the fallback tag FACT

**What shipped.** The server emits a fact id the client TAGS map does not know, so your best gas
line prints under the generic fallback tag.

**Repro.** The gas line arrives as:

```json
{ "id": "gas_burner_abs",
  "text": "You have paid Ethereum roughly $23,507 in gas so far. That is money that left and never came back." }
```

The client map (verbatim from your shipped page) has `gas_burner` but not `gas_burner_abs`:

```js
TAGS = {
  ratio:"FOLLOWS", engagement:"FEED", engagement_low:"FEED", text_wall:"OUTPUT", not_verified:"STATUS",
  posts_per_day:"VOLUME", firehose:"FOLLOWING", ghost:"HOLDINGS", top_bag:"POSITION",
  bio_dyor:"BIO", bio_nfa:"BIO", bio_noob:"BIO", bio_degen:"BIO", bio_builder:"BIO", bio_empty:"BIO",
  no_x:"X ACCOUNT", broke:"NET WORTH", thin:"NET WORTH", dust:"HOLDINGS", unpriced:"VALUATION",
  dead_holders:"LIQUIDITY", churn:"ACTIVITY", churn_lite:"ACTIVITY", gas_burner:"GAS PAID",
  spread:"CHAINS", top_loser:"PERFORMANCE", micro_top:"CONCENTRATION", no_ens:"IDENTITY",
  old_watcher:"SENIORITY", stable_dust:"CASH", no_stables:"RISK", per_follower:"MARKET CAP",
  fake_major:"AIRDROPS", tickers_over_dollars:"TICKERS", concentration:"CONCENTRATION",
  no_wallet:"EVIDENCE"
}
```

and the render site falls back:

```js
${TAGS[f.id]||"FACT"}
```

**Why it matters.** Small, but the strongest line on most receipts prints under a tag that reads like a
placeholder. It is also the canary for a class of bug: server and client disagree on fact ids, and every
future rename re-creates it silently.

**Minimal fix.** Add `gas_burner_abs:"GAS PAID"` to the map, or better, have the server send the tag with the
fact so the id lists cannot drift. COOKED validates the bank at build time: a line whose id has no tag fails
the build, turning this class of bug into a build error.

## 5. No rate limit, no cache, no budget on an endpoint that costs money per call

**What shipped.** Every POST fans out to at least five chain RPCs plus your paid Jev call, and
nothing stands between that cost and the internet.

**Repro.** Six different wallets posted in parallel, all returned 200:

```
burst of 6 distinct addresses: all 200, ~9s wall total, no 429
```

Identical unsalted repeat requests recompute from scratch (the engine's own `ms` field and the
score both change: `rekt` 93 then 92 on the same subject, `ms` 509 then 599), so there is no
response cache. Each response carries the Jev cost on your account:

```json
"jev": { "model": "typesafe/jev-1.13-20260917", "cost": 5.1912e-05 }
```

That is roughly $0.00005 per call for the model plus the upstream RPC fan-out, so a scraper doing
10k requests costs you real money and gets every address in its list roasted for free.

**Why it matters.** This is the one finding that can end the project: one script, one HN thread,
or one shared link with an auto-refresh and your Alchemy tier and Jev bill are gone.

**Minimal fix.** Three layers, all cheap on KV. A per-IP token bucket, a global daily cap, and a
cache check that runs BEFORE the rate limit so reloads and share links cost nothing. COOKED's
config (`src/40_worker.js`, verbatim):

```js
const RATE = { evm: 16, handle: 30, windowMin: 10, dailyCap: 4000 };
const TTL_SECONDS = 900;
```

```js
/* Cache first: a reload, a share link or a REPRINT costs nothing upstream, so it
   must not consume the visitor's rate budget. Only a real read counts. */
if (!salt) {
  const hit = await db.get(cacheKey);
  if (hit) return json({ ...hit, cached: true });
}
```

Two details I hit building this exact thing: put the cache lookup before the limiter (my first
version 429'd my own design gate during page reloads), and keep a /health route (yours 403s
today).

## 6. The brand implies a $ROAST token exists

**What shipped.** The token is in the title, the header and the footer, with no mint address and
no disclaimer anywhere.

**Repro.** Verbatim from the shipped page:

```html
<title>ROAST MY BAG - $ROAST</title>

$ROAST / MODEL REKT-1
ROAST MY BAG · $ROAST · WE DO NOT HOLD YOUR MONEY, WE JUST HOLD THE RECEIPT
```

There is not a single contract address on the page (I grepped for `0x` + 40 hex: zero hits), and
the only advisory-flavored line is a joke: "DYOR is a full sentence on this site."

**Why it matters.** To a visitor, `$ROAST` in the title of a wallet-reading site reads as a token
launch. That attracts two bad outcomes: people asking where to buy a thing that does not exist,
and you wearing a securities-adjacent brand for a product that is a comedy receipt printer. The
footer's "WE DO NOT HOLD YOUR MONEY" helps with custody, not with the implied token.

**Minimal fix.** Either drop `$ROAST` from the brand, or own it: mint address, a one-line "there
is no token, this is a joke" disclaimer, and keep the humor. One line in the footer is enough;
the current deadpan works better with the disclaimer than against it.

## 7. Prices from a single source, no cross-check

**What shipped.** One price per asset, taken from one source, accepted as-is. When that source is
wrong or down, the receipt is wrong or zero in the same proportion.

**Repro.** The whale response carried exactly one price per native asset:

```json
"prices": { "ETH": 2634.4852494824713, "BNB": 767.4815035905254, "POL": 0.1070607824512085 }
```

and the same response priced `MOONDAY`, a token with `holders: 0`, at `$60.53` per unit into a
$10,963 position. Zero holders means nobody trades this token at that price; the rate came from
one source and nothing checked it. On my own build, a single CoinGecko/DefiLlama outage zeroed an
entire net worth mid-test before I added a ladder, so this is not hypothetical.

**Why it matters.** The net worth is the spine of the receipt. One flaky source turns "your bag is worth
$X" into a coin flip, and the reader who checks one token on an explorer discounts the rest of the paper.

**Minimal fix.** A price ladder with a disagreement rule. COOKED tries DefiLlama first (keyless,
batched, ~80 keys per call), then exchange tickers, then CoinGecko last because it rate limits
under load. And when the explorer's own rate and the fetched rate disagree, refuse to price
rather than pick one (`src/30_engine.js`, verbatim):

```js
/* When the explorer quoted its own price and DefiLlama disagrees by more
   than 5x, one of them is wrong about units. We keep the position but
   refuse to price it, rather than print a number we cannot defend. */
if (t.rate0 > 0 && (p / t.rate0 > 5 || t.rate0 / p > 5)) { t.conflict = true; t.rate = null; t.usd = null; continue; }
```

## 8. Decimals artifacts: raw-unit balances priced as real

**What shipped.** Balances are divided by the token's decimals on the honor system. When a token
lies about decimals, or the client misreads them, a balance in raw units (1e26 scale) gets priced
as if it were real tokens.

**Repro (mechanism).** An address holding raw NEXO units at 1e26 scale prices out to roughly $170M on a
wallet whose real value is five figures. The vanity address `0x1111111111111111111111111111111111111111`
genuinely holds about 208M NEXO (roughly $170M), two independent sources agree, and that is exactly why the
right answer there is to report it, not clamp it.

**Repro (live symptom on your site today).**

```bash
curl -s -X POST https://roast-mybag.mtayebi1997.workers.dev/api/roast \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"0x1111111111111111111111111111111111111111"}'
```

Observed: native total about $16.2k, plus `MOONDAY` priced at `$60.53` with `holders: 0` into a
$10,963 position, plus 349 tokens "with no price". The vanity address's true headline is the
208M NEXO position, which your current token list does not surface at all.

**Why it matters.** Decimals artifacts and genuinely huge positions produce the same shape in the
data: one enormous number. If you clamp the big number you delete the true $170M story; if you
trust the big number you mint fake millionaires out of misparsed dust. The answer is to
cross-check before believing or suppressing.

**Minimal fix.** Sanity rails plus the 5x price cross-check from finding 7. COOKED's thresholds
(`src/10_config.js`, verbatim):

```js
/* Sanity rails. A token balance of 10^15 units or a million-dollar position in
   a token with 900 holders is a decimals artifact, not wealth. Such entries are
   reported as unpriced junk instead of being multiplied into a fake net worth. */
absurdBalance: 1e15,
absurdUsd: 1e7,
```

and the classifier nulls the dollar figure on suspicion while keeping the position visible
(`src/30_engine.js`, verbatim):

```js
/* decimals artifacts: an unpriceable balance must never become a dollar figure */
const suspect = t.conflict === true || bal > TH.absurdBalance
  || (usd != null && usd > TH.absurdUsd && (holders == null || holders < 1000));
if (suspect) usd = null;
```

The rails are generous: a real USDC or PEPE position never trips them, and when a vanity address
really is worth $170M, the cross-check confirms it instead of the clamp deleting it.

## 9. Contract vs person: no distinction in the shipped bundle, and 7702 is the trap

**What shipped.** The shipped page has no `eth_getCode` client logic at all (I grepped the bundle
for `eth_getCode`, `getCode`, `is_contract`, `ef0100`: zero hits), and the API response carries no
contract field. Result: contracts get roasted as people.

**Repro.**

```bash
curl -s -X POST https://roast-mybag.mtayebi1997.workers.dev/api/roast \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"}'
```

That is the USDC contract. Observed: `archetype: "whale_no_taste"`, `rekt: 20`, and person-directed
lines ("You are holding a counterfeit USDC token that nobody minted for you on purpose"). Same for
the Beacon deposit contract (`0x00000000219ab540356cBB839Cbe05303d7705Fa`): person roast, no
contract mention. A contract has no feelings, so the joke is wasted, and worse, it signals to the
reader that the engine cannot tell an address from an account.

**The trap to know before you add the check.** The obvious test, `code !== "0x"`, breaks on
EIP-7702: a delegated EOA carries code with the `0xef0100` prefix and is still a person. My own
build made exactly this mistake and labeled every modern smart wallet "not a person" until I
fixed it. These accounts are live right now: I pulled a fresh block, scanned senders, and found
`0xa42d32b50275415d3d02c9f28bd5d1310f2b55c3` with code `0xef010063c0c19a282a1b52...`. Your site
roasted it as a normal person, the right outcome with no mechanism behind it.

**Minimal fix.** The code read is already in the batch (see section A), so it costs nothing
extra. COOKED's rule (`src/30_engine.js`, verbatim):

```js
/* An EIP-7702 delegated EOA carries a 0xef0100 designator: that is a
   delegation, not a contract. Getting it wrong turns every modern wallet
   into "you are not a person". */
is_contract: !!(c.code && c.code !== "0x" && !/^0xef0100/i.test(c.code)),
delegate: /^0xef0100/i.test(c.code || "") ? "0x" + (c.code || "").slice(8, 48) : null,
```

Real contract: `contract_entity` archetype ("Not a wallet. A contract, wearing a wallet's address
as a disguise."). Delegated EOA: person, with the delegate address as a bonus fact, because "you
handed a stranger the keys and kept the receipts" is a great line that only exists if you read
the code.

## 10. Per-source timeouts are not isolated

**What shipped.** Slow reads can take down data that already arrived, and the counts flap between
runs because one flaky source reshapes the whole receipt.

**Repro.** Same host, same address, measured 2026-09-20: Blockscout counters answer in 0.64s while
token-balances for the same address took 29.26s and 3.3MB. On your API the same wallet gave `unpriced: 378`
then 417, `fake_token_count` 485 then 534, gas $23,507 then $23,536, `blockscout` flapping true/false, wall
times 2.2s to 8.9s. Everything on one host lives or dies together: when the heavy token list times out, the
counters you already paid for go down with it.

**Why it matters.** The reader sees different receipts for the same wallet on the same day, which
undermines the "the chain does not lie" premise. And you pay for the counters every single time,
even on the runs that throw them away.

**Minimal fix.** Wrap every read in its own timeout so a slow sibling can only kill itself.
COOKED's helper (`src/20_sources.js`, verbatim):

```js
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
```

and the composition rule that matters (`src/30_engine.js`, verbatim):

```js
/* Counters, token lists and ethplorer race independently: a slow token list
   must never cost us the counters we already paid for. */
const [countersRes, tokenRes, ethplorerRes] = await Promise.all([
```

Give the heavy token list a fixed budget (Blockscout token-balances is 12-16s typical, treat it
as optional enrichment), cap the rows you parse, and let the fast counters land every time. On
the free plan, waiting on I/O is free while parsing megabytes is not, so cap what you parse too.

## A. Verified source list (keyless, probed 2026-09-20)

Every endpoint below is keyless and answered from my line on 2026-09-20 with a browser
User-Agent. Latencies in parentheses are what I measured that day.

### Chain reads

| Need | Endpoint | Notes |
|---|---|---|
| Balance, nonce, code, gas price | JSON-RPC **batch** POST, one request per chain for 5 fields (0.65s) | Working RPCs: `ethereum-rpc.publicnode.com`, `eth-pokt.nodies.app`, `eth.drpc.org`, `1rpc.io/eth`, `rpc.flashbots.net`, `base-rpc.publicnode.com`, `mainnet.base.org`, `bsc-rpc.publicnode.com`, `bsc-dataseed.binance.org`, `arbitrum-one-rpc.publicnode.com`, `arb1.arbitrum.io/rpc`, `polygon-bor-rpc.publicnode.com`, `optimism-rpc.publicnode.com` |
| Dead RPCs | `eth.llamarpc.com`, `base.llamarpc.com` (525), `polygon-rpc.com` (401 key disabled), `rpc.ankr.com` (needs key) | keep them out of the pool |
| Per-address tx count, gas burned, token transfers | `https://<chain>.blockscout.com/api/v2/addresses/<a>/counters` (0.64s) | keyless, real gas used by that address, not an estimate from nonce |
| Token balances with holder counts | `https://<chain>.blockscout.com/api/v2/addresses/<a>/token-balances` (29.26s, 3.3MB that day) | keyless, eth/base can exceed 1.5MB: budget ~6.5s, treat as optional, cap rows parsed. Hosts: eth, base, arbitrum, polygon, optimism, gnosis |
| ETH token list, holder counts, price | `https://api.ethplorer.io/getAddressInfo/<a>?apiKey=freekey` (11.54s that day) | keyless, includes `holdersCount`. Rate limited behind Cloudflare egress IPs: retry once |
| NFTs held | `https://<chain>.blockscout.com/api/v2/addresses/<a>/nft?type=ERC-721%2CERC-404%2CERC-1155` | keyless |
| Solana native + SPL | `api.mainnet-beta.solana.com`, `getBalance` + `getTokenAccountsByOwner` (jsonParsed) | works |
| BNB chain tokens | no keyless token index exists | read native balance only and say so on the receipt |

The batch is the single highest-value trick here, five chains cost five requests instead of
twenty. COOKED's version (`src/20_sources.js`, verbatim):

```js
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
```

### Prices

| Need | Endpoint | Notes |
|---|---|---|
| Batch contract prices, many chains | `https://coins.llama.fi/prices/current/ethereum:0x...,base:0x...` (1.78s) | keyless, ~80 keys per call, run batches in parallel |
| 7d / 24h change | `https://coins.llama.fi/percentage/<same keys>` | optional enrichment |
| Native prices ladder | DefiLlama `coingecko:ethereum,...` first, then `api.bybit.com/v5/market/tickers?category=spot&symbol=ETHUSDT` (0.90s), CoinGecko last | Bybit answers from censored lines; CoinGecko rate limits under load |
| Also answering | `api.coinbase.com/v2/prices`, `api.binance.com/api/v3/ticker/price`, `api.dexscreener.com/latest/dex/tokens/<addr>` | re-probe before relying on them, exchange reachability shifts |

### Identity and public footprint

| Need | Endpoint | Notes |
|---|---|---|
| X profile: counters, bio, avatar, join date | `https://api.fxtwitter.com/<handle>` (1.46s) | keyless and it still returns `joined`, which the official API charges for. Rate limits under bursts: retry once after ~1.2s |
| X timeline | `cdn.syndication.twimg.com/...`, `syndication.twitter.com/...` | first returns an empty body, second 429s. Not dependable, do not build on it |
| ENS resolve + socials | `https://api.ensideas.com/ens/resolve/<addr-or-name>` (1.72s) | keyless, returns twitter/github/url/avatar |
| ENS avatar | `https://metadata.ens.domains/mainnet/avatar/<name>` | image, or the default gradient |
| GitHub | `https://api.github.com/users/<login>` | keyless, 60 req/h per IP |
| Telegram handle exists | `https://t.me/<handle>` | assert `tgme_page` or `Telegram: Contact` in the HTML |
| Farcaster | `https://api.warpcast.com/v2/user-by-username?username=<h>` | keyless: fid, displayName, followerCount |
| Keybase proofs | `https://keybase.io/_/api/1.0/user/lookup.json?username=<h>` | keyless, empty `them` array means not found |
| dev.to / GitLab / Linktree | `dev.to/api/users/by_username?url=`, `gitlab.com/api/v4/users?username=`, `linktr.ee/<h>` | all reachable |
| Domain age from a bio | `https://rdap.org/domain/<host>` + `https://dns.google/resolve?name=<host>&type=A` | registration date enables "the site is 3 months older than the token" |
| Blocked or bot-walled | reddit (403), medium (Cloudflare), codeberg (403), x.com via `r.jina.ai` (challenge), xcancel (451), nitter instances (DNS fail) | do not build on these |

### The Cloudflare egress trap

Free-tier APIs (ethplorer freekey, Blockscout) rate limit by IP, and your Worker shares egress
IPs with every other Worker on Cloudflare. You will see 429s you did not cause. One retry with
backoff turns a red source green; three retries turn a 10s receipt into a 24s timeout without
making it work. COOKED settled on two attempts at a 6.5s budget per source, and names the failed
source on the receipt instead. Also send a browser `User-Agent` on every request: Cloudflare
answers the default python UA with error 1010.

## B. Deploy recipe: Worker + KV + secret, no wrangler

Everything below works from a plain script with a Cloudflare API token (user token with Workers
Scripts + Workers KV Storage edit). Resolution order that has not failed me:
`$CLOUDFLARE_API_TOKEN`, then a local `cf_token.txt`. One gotcha before any of it: build your
HTTP opener with a null proxy handler, because dead `HTTP_PROXY` vars from an old VPN hijack
`urllib` and produce confusing connection errors.

```python
BASE = "https://api.cloudflare.com/client/v4"
H = {"Authorization": "Bearer " + TOKEN}

# 1 account + workers.dev subdomain
acc = GET  /accounts                                  # result[0]["id"]
sub = GET  /accounts/{acc}/workers/subdomain          # result.subdomain, else PUT {"subdomain": "name"}

# 2 KV namespace (create once, reuse by title)
ns = [n for n in GET /accounts/{acc}/storage/kv/namespaces?per_page=100 if n["title"] == "app-kv"] \
     or POST /accounts/{acc}/storage/kv/namespaces {"title": "app-kv"}["result"]["id"]

# 3 upload the module (multipart: metadata part + script part)
meta = {"main_module": "worker.js",
        "compatibility_date": "YYYY-MM-DD",
        "bindings": [{"type": "kv_namespace", "name": "APP_KV", "namespace_id": ns},
                     {"type": "plain_text", "name": "SOME_VAR", "text": "value"}]}
b = "----APP" + uuid4().hex
def part(name, filename, ctype, content):
    h = f'--{b}\r\nContent-Disposition: form-data; name="{name}"'
    if filename: h += f'; filename="{filename}"'
    h += f"\r\nContent-Type: {ctype}\r\n\r\n"
    return h.encode() + (content.encode() if isinstance(content, str) else content) + b"\r\n"
body = (part("metadata", None, "application/json", json.dumps(meta))
        + part("worker.js", "worker.js", "application/javascript+module", script)
        + f"--{b}--\r\n".encode())
PUT /accounts/{acc}/workers/scripts/{name}          # Content-Type: multipart/form-data; boundary={b}

# 4 secrets (kept out of the script; read from the local .env)
PUT /accounts/{acc}/workers/scripts/{name}/secrets {"name": "API_KEY", "text": key, "type": "secret_text"}

# 5 expose on workers.dev
POST /accounts/{acc}/workers/scripts/{name}/subdomain {"enabled": true, "previews_enabled": false}

# 6 verify: poll https://{name}.{sub}.workers.dev/health until {"ok":true,"rev":...}
```

Gotchas, each paid for once:

- `main_module` must match the filename in the part, and the content type is
  `application/javascript+module` for `export default { fetch }`.
- Re-uploading is idempotent. KV bindings are re-declared on every upload, so keep the namespace
  id stable.
- Set `Cache-Control` on the HTML deliberately and remember it: a verification run inside the
  cache window measures the OLD page. Append `?cb=<epoch>` to verification requests or your own
  close-out checks lie to you.
- Free plan: 10ms CPU per request and 50 subrequests. Waiting on I/O is free, so parallel fan-out
  is cheap while parsing a multi-megabyte explorer payload is not. Cap what you parse.
- Keep a `/health` route that echoes a build revision (yours currently 403s). A dead Worker is
  usually one of three things: an upload that returned `success: false`, a missing binding the
  script reads at top level, or an absent secret so a code path throws. `/health` should report
  which optional integrations are configured. That single route turns "is my deploy live" from a
  guess into one call.

## C. The honesty invariants, as a copy-paste test list

This is the harness that caught most of the bugs above in my own build, including three I would
never have seen by staring at receipts. It posts a table of subjects to `/api/roast` and asserts
instead of printing. Subjects (`tools/verify_engine.py`, verbatim):

```python
SUBJECTS = [
    ("whale with tokens",     {"x": "vitalikbuterin", "wallet": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"}),
    ("handle only",           {"x": "capital_fa"}),
    ("whale no handle",       {"wallet": "0x28C6c06298d514Db089934071355E5743bf21d60"}),
    ("tiny wallet",           {"wallet": "0x4200000000000000000000000000000000000042"}),
    ("empty address",         {"wallet": "0x1111111111111111111111111111111111111111"}),
    ("deposit contract",      {"wallet": "0x00000000219ab540356cBB839Cbe05303d7705Fa"}),
    ("solana",                {"wallet": "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg"}),
    ("bad wallet",            {"wallet": "0xnotanaddress"}),
    ("nothing at all",        {}),
]
```

The invariants checked on every response (`tools/verify_engine.py`, `invariants()`, verbatim):

```python
def invariants(name, d, status):
    if status != 200:
        check(d.get("error"), f"{name}: non-200 without an error message")
        return
    check(d.get("ok") is True, f"{name}: ok flag missing")
    ch, sc = d.get("chain", {}), d.get("score", {})
    rec = d.get("receipt", [])
    check(0 <= sc.get("rekt", -1) <= 100, f"{name}: rekt out of range")
    check(len(rec) <= 7, f"{name}: more than 7 printed lines ({len(rec)})")
    for f in rec:
        check(not re.search(r"\{[a-zA-Z]\w*\}", f["text"]), f"{name}/{f['id']}: unfilled slot -> {f['text'][:60]}")
        check("\u2014" not in f["text"], f"{name}/{f['id']}: em dash in line")
        check(bool(f.get("tag")), f"{name}/{f['id']}: no tag")
        check(len(f["text"]) <= 260, f"{name}/{f['id']}: line too long")
    # coverage truth: every named missing source must actually be a failed source
    cov = d.get("coverage", [])
    missing = set((d.get("data_truth") or {}).get("missing") or [])
    failed = {c["source"] for c in cov if not c["ok"]}
    check(missing == failed, f"{name}: data_truth.missing {sorted(missing)} != failed sources {sorted(failed)}")
    check(bool(d.get("data_truth", {}).get("note")), f"{name}: no data_truth note")
    # x-only honesty: no wallet => no chain claims, labelled basis
    if not d.get("input", {}).get("wallet"):
        check(sc.get("basis") == "x-only", f"{name}: x-only run not labelled (basis={sc.get('basis')})")
        check(not any(f["family"] == "chain" for f in rec), f"{name}: chain facts printed with no wallet")
        check(ch.get("kind") == "none", f"{name}: chain kind not none")
    # score arithmetic must be reconstructable from the reported components
    comps = sc.get("components", [])
    total_w = sum(c["weight"] for c in comps if c["value"] is not None)
    if total_w:
        recon = sum(c["value"] * c["weight"] for c in comps if c["value"] is not None)
        check(abs(recon - sc["rekt"]) <= 1.5, f"{name}: score does not reconstruct ({recon:.1f} vs {sc['rekt']})")
    check(d.get("verdict"), f"{name}: no verdict line")
    check(d.get("archetype", {}).get("desc"), f"{name}: archetype without a description")
```

The x-only block kills finding 1, the missing-equals-failed check kills finding 2, and the
score-reconstruction check catches any silent weight change while you fix the rest. Run it
against your live URL after every deploy:

```bash
python tools/verify_engine.py --url https://roast-mybag.mtayebi1997.workers.dev
```

Two practical notes if you port the harness: verify with a cache-buster or you will re-measure a
cached page, and expect the "bad wallet" and "nothing at all" subjects to fail loudly (your
current API returns 200 with a roast for `0xnotanaddress`, which the harness flags as a defect
worth having opinions about).

## Reference implementation

COOKED is the rebuild I made while finding all of this: six EVM chains plus Solana, an OSINT
layer, a 400-line written joke bank, and every invariant in section C asserted in CI-style at
build time. It is live and the source is open to you as the working reference for every fix in
this document:

- Live: https://cooked.shojaee76.workers.dev
- Source: https://github.com/shojaee76-cmyk/cooked-engine (src/ for the engine and worker,
  tools/verify_engine.py for the harness, references/ for the source list and deploy notes,
  punchlines/ for the joke bank in all four registers)

Same journey, same bugs: my build shipped all ten of these first. If you ship one fix, make it
the handle-only path; that is the one your users will notice.
