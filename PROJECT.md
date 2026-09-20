# COOKED — the receipt your wallet was dreading

A roast engine for a wallet and an X account. Paste an address and a handle, and it reads
public chain data, the public profile, and public records, then prints a receipt with a
REKT score, an archetype and a set of lines that each carry the number they came from.

- **Live:** https://cooked.shojaee76.workers.dev
- **Source:** `C:/Users/capit/cooked` (Cloudflare Worker + single-page front end, no framework)
- **Status:** shipped and verified (see Verification).

## What it is

| | |
|---|---|
| Product | a forensic receipt printer for crypto wallets and X accounts |
| Reads | Ethereum, Base, Arbitrum, Polygon, BNB, Optimism + Solana (native and SPL) |
| Public footprint | X profile counters and join date, ENS records, GitHub, Telegram, Keychain/Keybase, dev.to, GitLab, Linktree, Farcaster, and the domain in the bio |
| Writes | nothing. No keys, no signatures, no connection, no accounts, no cookies, no analytics |
| Money math | balance x price per token, spam separated, decimals artifacts refused, conflicting sources priced as unknown rather than invented |
| Judgement | deterministic engine writes the lines from measured facts; a typed model (Jev) only chooses between lines that already exist |
| Failure mode | sources that fail are named on the receipt, and the facts that needed them are left off rather than guessed |

## Why it exists

`roast-mybag.mtayebi1997.workers.dev` does the same job with the same receipt metaphor.
COOKED is the version that fixes its data and honesty problems and adds the OSINT and
comedy layers.

### Defects in the original, and what COOKED does instead

| Original problem | COOKED |
|---|---|
| With an X handle and no wallet it printed an on-chain archetype anyway ("empty_wallet", "never put a dollar in it") at REKT 93 | No wallet means the chain components are **unknown, not zero**: the weight is redistributed, `score.basis` says `x-only`, X-only archetypes (`x_lurker`, `x_broadcaster`, ...) describe a posting record, and the paper prints "NO WALLET ON FILE" |
| `partial: false` while two of three token sources were down, and the receipt still printed "NET WORTH ON-CHAIN" as authoritative | Every source is timed and reported individually in a SOURCES block; `data_truth.missing` names exactly what was not read and the printed facts are the ones that could be verified |
| Spam dust counted as evidence | spam is classified (holders + value), valued separately, and never mixed into the net worth |
| `gas_burner_abs` printed with no tag | every fact carries a tag; the bank is validated at build time |
| No rate limit, no cache, no budget on an endpoint that costs money per call | per-IP token bucket, 4000/day global cap, 15 minute KV cache, per-source time budgets, hard 20s engine cap |
| Branded a token with no mint and no disclaimer | no token, no contract, and the footer says what it does not do |
| Deadpan lines with no comedy discipline | a written doctrine (`spec/punchline_spec.md` + `references/comedy-roast-craft.md`), 212 vetted lines built from numbered facts, sequencing rules in the engine |
| Single chain family | six EVM chains plus Solana, one input box auto-detecting the address type |

### New capabilities

- **OSINT layer:** ENS (name, avatar, socials), public handle footprint across seven platforms,
  GitHub profile, Telegram, Farcaster, and RDAP/DNS age of the website in the bio.
- **Honest money rails:** a token is priced only when the explorer and DefiLlama agree within 5x;
  a suspect balance (decimals artifacts, `>10^15` units) is reported as unpriced junk, never multiplied
  into a fake net worth.
- **Measured gas:** real per-address `gas_usage_count` from Blockscout, converted at today's gas price
  and labelled as an estimate. The gas quantity itself is measured.
- **Explainable score:** seven components (gas, dust, taste, churn, vanity, exposure, liquidity) with
  visible weights, renormalised when a component is unknown. Same inputs, same score.
- **Comedy engine:** fact selection by weight with sequencing rules (opening situation, escalation pair
  for dust/unpriced, one family never twice in a row, the hardest line held for the position before the
  verdict, seven lines maximum), a seeded RNG so a wallet gets a stable receipt per day, and REPRINT for
  fresh lines on the same numbers.
- **Sharing:** share link with `?x=&w=` that auto-prints, a QR code printed on the receipt, save as text,
  and a real print stylesheet.
- **Same code runs locally and in production:** `dist/worker.js` is served by Cloudflare and by
  `dist/local_server.js` under Node, so the local test exercises the shipped artifact.

## Layout

```
cooked/
  src/00_punchlines.js   joke bank (injected at build)
  src/10_config.js       chains, rpc pools, thresholds, score weights, archetypes
  src/20_sources.js      every reader (rpc batch, blockscout, ethplorer, llama, fxtwitter, ens, osint, solana)
  src/30_engine.js       facts, score, archetype, receipt composition, Jev
  src/40_worker.js       routing, cache, rate limit, error shapes
  front/index.html       the machine, the paper, the readings panel
  build.py               assembles + validates + writes dist/
  deploy.py              Cloudflare Workers deploy + live verify
  tools/verify_engine.py acceptance harness (9 subjects, honesty invariants)
  punchlines/*.json      the lines, written to spec/punchline_spec.md
  spec/                  api contract + punchline spec
  references/            comedy craft notes
```

## Build, run, deploy

```bash
python build.py                     # dist/worker.js, dist/index.html, dist/punchlines.json
node dist/local_server.js           # local host on :8787 (same bundle that ships)
python tools/verify_engine.py       # acceptance harness against localhost
python deploy.py                    # build + push to Cloudflare + verify /health
```

Cloudflare: account Shojaee76, worker `cooked`, KV `cooked-kv`, secret `JEV_KEY` (OpenRouter), var `JEV_MODEL`.
Desktop launcher: `Play COOKED.bat`.

## Verification

- `tools/verify_engine.py`: 9 subjects (whale + handle, handle only, whale, tiny wallet, empty address,
  deposit contract, Solana, bad address, empty request). Invariants enforced: receipts <= 7 lines, no
  unfilled slot, no em dash, every line tagged, `data_truth.missing` must equal the set of failed sources,
  no chain facts when no wallet was given, x-only runs labelled, and the reported score must reconstruct
  from the reported component weights within 1.5 points.
- Live: `https://cooked.shojaee76.workers.dev/health` returns `ok` with the deployed revision.
- Real receipts produced from this line for: vitalik.eth + @vitalikbuterin, the Binance hot wallet,
  the Beacon deposit contract, an empty vanity address, @capital_fa (X-only), and a Solana address.
- Big-number cross-check performed by hand: the 0x1111…1111 vanity address really does hold
  ~208M NEXO (~$170M). Two independent sources agree, so the total is reported rather than suppressed.

### designcheck verdict (live URL, 2026-09-20)

```
Target: https://cooked.shojaee76.workers.dev/?x=capital_fa&w=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&nofx=1&cb=…
at 390px, 1024px, 1440px (two views: first screen, receipt printed).
Verdict: PASS - 0 hard findings, 12 soft.
```

Hard findings fixed during the gate (each one caught on the live URL, not the local build):

1. em dash in visible copy: it was hiding in `<title>`, `og:title` and an `&mdash;` in the wallet label.
2. 429 from my own rate limiter while the gate reloaded the page: the cache lookup now runs **before** the
   rate limit, so a reload, a share link or a REPRINT costs no budget. Per-IP budget 16 reads / 10 min.
3. First gate run measured a **stale page**: the Worker serves HTML with `max-age=120` and the run started
   inside that window, so every earlier finding looked unfixed. Verification now always appends `?cb=<epoch>`.

Soft findings accepted, with reasons:

| Finding | Decision |
|---|---|
| Contrast on muted labels (3.2-4.3:1, 10-11.5px) | **Fixed.** Every muted grey on the machine was lifted (#6f6b5e -> #a8a293, #7e7a6c -> #aea898, #8b8778 -> #b5afa0) and the type floor raised to 12px. |
| Text nodes under 12px | **Fixed** in the interface; the receipt itself is a printed document and its 12-14px mono is deliberate. |
| Tap targets under 40px | **Fixed** (buttons now 44px minimum, the CTA 56px). |
| favicon 404 | **Fixed** with an inline SVG paper-receipt icon. |
| One image in the DOM not visible at a given width | The QR is a data-URI canvas image that only exists once a receipt has printed; not a defect. |
| Copy lines over 95 characters at 1440px | **Fixed** with `max-width` in `ch` units on the explanatory blocks. |
| Vision: "the receipt is a secondary detail, redesign the layout" | **Rejected, with reason.** The receipt *is* the product; the machine and the readings exist to make the paper credible. The panel is the audit trail, not decoration. |
| Vision: "drab palette", "the dot matrix aesthetic is a crutch" | **Rejected, with reason.** The palette is a warm graphite machine against paper stock, deliberately not the default dark-indigo dashboard look. The dot-matrix reading is the paper texture at 3.5% opacity. |
| Vision: "boxy and uninspired", "three identical cards" | **Rejected.** No cards exist in the layout; the machine is a single object and the readings are one panel. |

Vision review's three ranked fixes and what happened to them: (1) simplify the header/input area so the CTA is
the focus - fixed with the specimen receipt on first paint, more padding and a 56px CTA; (2) overhaul the
typography - fixed, the floor is 12px, labels are consistent, numbers are tabular, long copy is width-capped;
(3) consistent spacing rhythm - addressed by raising every group, row and padding step (14 items in one pass).
The remaining "redesign everything" advice conflicts with the product premise and is recorded above as a
considered rejection rather than silently ignored.

## The heat dial (2026-09-20, user correction: "you didn't cook people, I want insults")

The first bank was written as a coroner's report. Accurate, defensible, and too polite: it described
people instead of judging them. The write-up of the craft (`references/comedy-roast-craft.md`) optimised
for "no line you cannot defend", which produced observation where the product needed contempt.

The fix is a register system, not a rewrite of the guardrails:

- Every line carries a `tier`: `gentle`, `medium`, `savage`, `brutal`.
- `POST /api/roast` takes `heat` 1-3. The page ships a MILD / SPICY / COOKED switch, default **COOKED**,
  and the setting travels in the share link and the cache key, so a shared link reprints at the same heat.
- Selection is deterministic per level: heat 1 reads gentle+medium, heat 2 adds savage, heat 3 reaches
  for the hardest tier the bank has for that fact, then fills the rest from the next tier down.
- The receipt prints its own heat level, next to the archetype, so the paper is honest about how hard it
  pulled. The verdict pool and the archetype descriptions are tiered the same way.
- New spec for the brutal register: `spec/brutal_spec.md` (contempt, humiliation by accuracy, the kill
  shot, the nobody line, the legacy line) with ten voice exemplars.

**What heat does not change**, and this is a deliberate product decision rather than a limitation: no
slurs, no attacks on body, family, faith, health, gender or nationality, at any heat level, enforced by
the build-time identity guard. Contempt has to be earned by a number. For a wallet under $50 the line hits
the gap between how he posts and what he holds, never the poverty itself, because "you post like a whale
and hold $40" is a joke and "you are poor" is not. The bar every tier is held to: the subject sends the
receipt to his group chat. Fury is a failed line; a bruised laugh is a working one.

## Known limits

- BNB Chain has no keyless token index, so only its native balance is read there. It is left off rather
  than faked.
- Ethereum token reads go through ethplorer (free key) and Blockscout; on Cloudflare's shared egress IPs
  these are occasionally rate limited. One retry is attempted, and a failure is named on the receipt.
- Cloudflare free-plan CPU limits mean the heavy explorer reads are budgeted at 6.5s each; a slow chain
  drops out with a named source rather than hanging the receipt.
- The engine does not look at private data by design: no breaches, no leaks, no email or phone lookups,
  no login walls, nothing about family or bodies.

## Progress log

- 2026-09-20 recon: mapped every reachable data source from this line (RPC batch, Blockscout keyless,
  ethplorer freekey, DefiLlama, Bybit, fxtwitter, ENS, RDAP, Solana RPC) and the original's defects.
- 2026-09-20 build: engine, sources, worker, front end, joke bank (212 lines), build and deploy pipeline.
- 2026-09-20 fixes found by running it: BigInt leak into JSON; price source fragility zeroing net worth;
  EIP-7702 delegated EOAs read as contracts; counters discarded when a sibling read timed out; ethplorer
  list dropped when the explorer read failed; decimals artifacts inflating net worth; dust/per-follower/
  fake-major lines printing misleading zeros; cached responses shipping an aliased empty coverage array.
- 2026-09-20 shipped to Cloudflare Workers with KV cache, rate limit, and the Jev secret.

- 2026-09-20 final polish + re-verification: a stale gate run (jammed by the rate limiter before the
  cache-first fix) plus a second pair of eyes on the phone layout produced three more fixes: the
  42-character hex placeholder read as clipped text (now `0x… (evm) or a solana address`), the CTA now
  goes full width when the form wraps, and the paper body sits at 13px on phones. Gate re-run on the
  live URL at 390/1024/1440 with a cache-buster: PASS, 0 hard, 10 soft. Deployed revision
  `20260920-103939`, byte-checked by fetching the live HTML and grepping for the new placeholder and
  media query rather than trusting the deploy script's own success message.

- 2026-09-20 error-state pass (a stale gate run caught it): the rate-limited / failed state was an
  unreadable pale band. It is now a proper PRINTER ERROR receipt: what happened, what was not charged,
  and a full-width "press here to print again" button wired back to the printer. Verified against the
  live bundle by forcing a 400 through the local Node host and re-running the gate: 0 soft findings,
  no em-dash finding, and the vision review no longer reports the band as unreadable. That run's two
  remaining hard findings are the deliberate 400 (the harness treats a failed fetch as a defect, which
  it should for a normal page) and nothing else.
- 2026-09-20 retries retired: giving the ETH/Base token sources three attempts and a 9s budget pushed a
  receipt to 23.7s and still failed, because eth.blockscout.com and ethplorer throttle Cloudflare's own
  egress IPs rather than mine. Reverted to two attempts at 6.5s. No keyless alternative exists from here
  (DeBank openapi does not resolve on this line, Blockchair blacklists shared IPs), so the honest path is
  the one shipped: the source is named on the paper, the affected facts stay off, the score renormalises.
- Known soft finding, accepted: the designcheck ledger reports convergence with an earlier project on
  font families plus 0px/4px radii. The type is Barlow Condensed + Azeret Mono against warm graphite and
  paper stock, and the composition (one machine printing one paper) does not repeat any earlier layout,
  so this is recorded rather than redesigned.

- 2026-09-20 receipt layout pass (the oldest gate run finally landed and it was right about four
  things on the printed paper): the SURVIVING stamp was absolutely positioned and crossed receipt text,
  so it now lives in its own reserved band in the flow where it physically cannot cover content; the
  barcode and QR stack on phones instead of clipping; every table value is tabular-numeric so columns
  align on the digit; the footer facts are two centred lines instead of one misaligning line; and the
  near-duplicate type sizes were folded into a single scale (12/13/14/15/18/26 + display).
- 2026-09-20 self-inflicted bug, caught by the gate: making the stamp JS-revealed left an element at
  `opacity: 0` whenever the reveal did not run. The stamp is now visible by default and `.show` only
  triggers the thunk animation, so there is no invisible-element failure mode left in the receipt.
- Gate re-run on the live URL after those fixes, rev `20260920-105734`, 390 and 1440, cache-busted:
  PASS, 0 hard, 6 soft. The remaining soft findings are the receipt's deliberately small mono body,
  the deliberate dark-machine palette, and the "3s read" heuristic of the critic, all recorded above.
- Convergence note: the ledger's "looks like your other projects" line now matches `cooked-jam`, which
  is my own error-state render of this same product under a different gate name. It is a self-match, not
  convergence with another project; the font families are unique to this build and no earlier project
  uses this composition.

- 2026-09-20 BRUTAL register shipped: 233 new lines written to `spec/brutal_spec.md` by three writers
  working in parallel, merged with the dry bank. Bank now 423 lines (211 brutal, 126 medium, 43 gentle,
  43 savage), 18 verdicts (10 of them brutal), 12 archetype descriptions with an insulting variant each,
  and 57 of 59 fact ids carry a brutal line (the two gaps fall back to written defaults). The build gate
  reports the register mix on every build and the identity guard still passes clean over all 423 lines,
  18 verdicts and 12 descriptions.
- Measured difference between the registers, same wallet, same day: MILD reads "You hold 270 tokens under
  a dollar out of 1,600... The gas would ask for more" and COOKED reads "You paid $168 in fees to hold
  $709,432. The validators remember you. Nobody else does." Verdict at COOKED: "The chain will not forget
  you. It will just stop mentioning you, and it already has."
- Gate re-run on the live URL after the heat control and the new bank, rev `20260920-114448`, 390 and
  1440, cache-busted: PASS, 0 hard, 6 soft.
