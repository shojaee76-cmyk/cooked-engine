# COOKED — API contract v1

`POST /api/roast` `{ handle, wallet, salt }` -> `200 application/json`

Rules that the front-end and the engine both rely on:

1. **Nothing is invented.** Every number in `facts[].measured` came from a source in
   `coverage[]` that returned `ok: true`. If a source failed, the fact that needed it is
   absent, not approximated.
2. **Missing data is named, not hidden.** `data_truth.missing[]` lists exactly what could not
   be read. The receipt prints it in a SOURCES block. There is no "partial" flag that
   silently stays false.
3. **Estimates are labelled as estimates.** Only the USD conversion of gas uses a live price
   and says so (`measured.gasPriceNote`).
4. **Score is explainable.** `score.components[]` always sums (weighted) to `score.rekt`.
5. **Roast text never contains an em dash** and never leaves an unfilled `{slot}`.

```jsonc
{
  "ok": true,
  "receipt_id": "ck_8f3a12",
  "generated_at": "2026-09-20T16:41:02Z",
  "ms": 4210,
  "cached": false,
  "input": { "handle": "capital_fa", "wallet": "0x…", "kind": "evm" },   // kind: evm | solana | none

  "subject": {
    "label": "@capital_fa",           // what the receipt calls them
    "avatar": "https://…",            // public avatar or null
    "ens": "vitalik.eth",             // or null
    "name": "استاد موپالمو"
  },

  "x": {                              // null when no handle or lookup failed
    "handle": "capital_fa",
    "name": "…", "bio": "…", "avatar": "…", "banner": "…",
    "followers": 79, "following": 207, "tweets": 821, "likes": 6121, "media": 26,
    "joined": "2011-08-24", "years": 15, "verified": false, "protected": false,
    "location": null, "website": null, "source": "fxtwitter"
  },

  "chain": {
    "kind": "evm",                    // evm | solana | none
    "net_worth_usd": 27244.79,
    "spam_usd": 365.3,
    "eth_price": 2643.7,
    "tokens": [                       // priced holdings, spam excluded
      { "chain": "arb", "sym": "USDT0", "name": "USDT0", "balance": 253.33, "usd": 253.29,
        "holders": 4371966, "chg7": null, "priced": true, "spam": false, "fake_major": false }
    ],
    "dust_count": 378, "unpriced_count": 378, "token_count": 402, "fake_token_count": 0,
    "chains": [
      { "key": "eth", "label": "Ethereum", "sym": "ETH", "balance": 6.71, "usd": 17623.35,
        "nonce": 5956, "tx_count": 78354, "gas_used": 1210117613, "token_transfers": 403376,
        "is_contract": false, "delegate": null, "ok": true }
    ],
    "sol": null                       // { balance, usd, spl_count, spl_usd, spam_count } for solana subjects
  },

  "identity": {
    "ens":      { "name": "vitalik.eth", "avatar": "…", "avatar_kind": "nft|image|default",
                  "length": 11, "twitter": null, "github": null, "url": null, "found": true },
    "github":   { "login": "…", "repos": 12, "followers": 3, "created": "2019-04-02" },
    "telegram": { "handle": "…", "exists": true },
    "farcaster":{ "username": "…", "followers": 120, "fid": 3 },
    "domain":   { "host": "example.com", "created": "2021-02-11", "age_days": 2000, "resolves": true },
    "platforms":[ { "name": "github", "url": "…", "found": true } ],
    "exposure_count": 4
  },

  "facts": [ { "id": "gas_burner_abs", "family": "chain", "weight": 8, "tier": "medium",
               "device": "sharpest reframe", "tag": "GAS PAID",
               "text": "You have burned {gasUsd} in gas…",
               "measured": { "gasUsd": "$23,455", "gasUsed": 1210117613 } } ],

  "receipt": [ /* the facts that actually print, in order, same shape */ ],

  "score": {
    "rekt": 40, "level": "COPE",      // RESPECT <30, SURVIVING <50, COPE <70, REKT <85, HOPELESS <95, COOKED >=95
    "components": [
      { "key": "gas",   "label": "GAS PAID",   "value": 71, "weight": 0.15, "note": "…" }
    ]
  },

  "archetype": { "id": "dust_collector", "name": "DUST COLLECTOR", "desc": "…", "conf": 0.61 },

  "jev": { "used": true, "model": "typesafe/jev-1.13", "cost": 0.00007, "ms": 880,
           "picked_verdict": 1, "archetype_agree": true },

  "coverage": [ { "source": "rpc:eth", "ok": true, "ms": 780 },
                { "source": "blockscout:eth", "ok": true, "ms": 849 },
                { "source": "fxtwitter", "ok": false, "ms": 8000, "error": "timeout" } ],

  "data_truth": { "complete": true, "missing": [], "note": "All sources answered." },

  "verdict": "…"
}
```

## Failure shape
`400 {"ok":false,"error":"…"}` for bad input, `429 {"ok":false,"error":"…","retry_after":60}`
when rate limited. The front-end prints both as a PAPER JAM receipt, never as a blank page.

## Caching
Cache key = `wallet|handle` (lowercased) with an optional `salt`. TTL 900s. Cached responses
carry `"cached": true` and the original `generated_at`.
