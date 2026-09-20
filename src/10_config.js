/* ============================================================================
   COOKED — config: chains, sources, price ids, scoring weights, palettes
   Runs on Cloudflare Workers AND on Node 22 (local dev). No CF-only APIs here.
   ========================================================================== */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/* Chains we can actually read from a censored line, in measured order of use.
   rpc[] = health-ordered fallbacks (probed 2026-09-20 from this network). */
const CHAINS = [
  {
    key: "eth", label: "Ethereum", sym: "ETH", cg: "ethereum", llama: "ethereum", decimals: 18,
    rpc: ["https://ethereum-rpc.publicnode.com", "https://eth-pokt.nodies.app", "https://eth.drpc.org",
          "https://1rpc.io/eth", "https://rpc.flashbots.net"],
    bs: "https://eth.blockscout.com", exp: "https://etherscan.io/address/",
  },
  {
    key: "base", label: "Base", sym: "ETH", cg: "ethereum", llama: "base", decimals: 18,
    rpc: ["https://base-rpc.publicnode.com", "https://base-pokt.nodies.app", "https://mainnet.base.org"],
    bs: "https://base.blockscout.com", exp: "https://basescan.org/address/",
  },
  {
    key: "arb", label: "Arbitrum", sym: "ETH", cg: "ethereum", llama: "arbitrum", decimals: 18,
    rpc: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
    bs: "https://arbitrum.blockscout.com", exp: "https://arbiscan.io/address/",
  },
  {
    key: "poly", label: "Polygon", sym: "POL", cg: "matic-network", llama: "polygon", decimals: 18,
    rpc: ["https://polygon-bor-rpc.publicnode.com"],
    bs: "https://polygon.blockscout.com", exp: "https://polygonscan.com/address/",
  },
  {
    key: "bsc", label: "BNB", sym: "BNB", cg: "binancecoin", llama: "bsc", decimals: 18,
    rpc: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"],
    bs: null, exp: "https://bscscan.com/address/",
  },
  {
    key: "opt", label: "Optimism", sym: "ETH", cg: "ethereum", llama: "optimism", decimals: 18,
    rpc: ["https://optimism-rpc.publicnode.com"],
    bs: "https://optimism.blockscout.com", exp: "https://optimistic.etherscan.io/address/",
  },
];

const SOLANA = {
  key: "sol", label: "Solana", sym: "SOL", cg: "solana", llama: "solana", decimals: 9,
  rpc: ["https://api.mainnet-beta.solana.com"],
  exp: "https://solscan.io/account/",
  splToken: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
};

/* Major tickers. A token claiming one of these with a tiny holder base is a counterfeit
   copy, which we report as a measured fact rather than a guess. */
const MAJOR_TICKERS = ["USDC", "USDC.E", "USDT", "USDT0", "DAI", "WETH", "WBTC", "ETH", "BNB",
  "POL", "MATIC", "WPOL", "LINK", "UNI", "ARB", "PEPE", "SHIB", "BUSD", "CBBTC", "WBTC.E"];

/* Dust / spam thresholds. Documented in the receipt so the reader can audit them. */
const TH = {
  dustUsd: 1,            // position under this = dust
  spamHolders: 30,       // token with fewer holders AND under $5 is ticketed as spam
  spamUsd: 5,
  fakeMajorHolders: 200,   /* a real major ticker never has fewer holders than this */// claiming a major ticker with fewer holders than this = counterfeit
  microMcap: 250000,
  /* Sanity rails. A token balance of 10^15 units or a million-dollar position in
     a token with 900 holders is a decimals artifact, not wealth. Such entries are
     reported as unpriced junk instead of being multiplied into a fake net worth. */
  absurdBalance: 1e15,
  absurdUsd: 1e7,
  thinWallet: 50,
  whale: 100000,
  gasPerTxFallback: 120000,
};

/* Score components. Each is produced 0-100 by the engine, then weighted. Weights sum to 1. */
const SCORE_WEIGHTS = [
  { key: "gas",      label: "GAS PAID",       w: 0.14 },
  { key: "dust",     label: "DUST",           w: 0.18 },
  { key: "taste",    label: "TASTE",          w: 0.18 },
  { key: "churn",    label: "CHURN",          w: 0.12 },
  { key: "vanity",   label: "VANITY",         w: 0.16 },
  { key: "exposure", label: "EXPOSURE",       w: 0.12 },
  { key: "liquidity",label: "LIQUIDITY",      w: 0.10 },
];

const LEVELS = [
  { min: 95, name: "COOKED",     note: "There is no coming back from this one." },
  { min: 85, name: "HOPELESS",   note: "Structural. Not behavioural." },
  { min: 70, name: "REKT",       note: "Documented, repeatable, expensive." },
  { min: 50, name: "COPE",       note: "You are managing it. Badly." },
  { min: 30, name: "SURVIVING",  note: "Barely, and on purpose." },
  { min: 0,  name: "RESPECT",    note: "Annoyingly fine. We looked twice." },
];

const ARCHETYPES = {
  empty_wallet:   "Has never sent a transaction on any chain and still has opinions about the market.",
  dust_collector: "Accumulates hundreds of dead token balances worth fractions of a cent and calls it a portfolio.",
  silent_holder:  "Bought one thing years ago, never sold, never looked again, no idea what it is worth.",
  whale_no_taste: "Enough money to be taken seriously and still holding tokens with four thousand holders and no stablecoins.",
  stable_maxi:    "Allergic to volatility and to upside. The most aggressively boring wallet on the chain.",
  exit_liquidity: "Primarily a place where other people's tokens come to die.",
  degen_churner:  "Moves money constantly and arrives nowhere. Gas is the only asset held long term.",
  airship_hopeful:"Waiting for a token that has not launched yet. Has done this four times.",
  ghost_account:  "An X account that posts nothing and a wallet that holds nothing. A monument to intention.",
  farming_bot:    "Whatever this is, it is optimised for something other than being a person.",
  vesting_survivor:"Everything arrived in one transaction and has not moved since. Waiting out a clock nobody else can see.",
  contract_entity:"Not a wallet. A contract, wearing a wallet's address as a disguise.",
  /* X-only subjects. The archetype must describe a posting record, never pretend
     a chain was read when no wallet was given. */
  x_absent:      "No wallet and no readable account. We are roasting the intention.",
  x_ghost:       "The account exists, posts nothing, and holds nothing. A monument to intention.",
  x_lurker:      "Follows far more than follows back. Reads everything, risks nothing, says less.",
  x_broadcaster: "Publishes continuously to an audience that is not there, about a portfolio that is not there.",
  x_brand_account:"A personal account wearing a company name and a pitch for a bio.",
  x_commentator: "Has watched every cycle from the outside with total confidence.",
};

/* Which platforms we check for a public handle footprint. All public pages, no login,
   no account enumeration beyond what any browser could do. */
const OSINT_PLATFORMS = [
  { name: "github",   url: (h) => `https://github.com/${h}`,              api: (h) => `https://api.github.com/users/${h}` },
  { name: "telegram", url: (h) => `https://t.me/${h}`,                    api: (h) => `https://t.me/${h}` },
  { name: "keybase",  url: (h) => `https://keybase.io/${h}`,              api: (h) => `https://keybase.io/_/api/1.0/user/lookup.json?username=${h}` },
  { name: "devto",    url: (h) => `https://dev.to/${h}`,                  api: (h) => `https://dev.to/api/users/by_username?url=${h}` },
  { name: "gitlab",   url: (h) => `https://gitlab.com/${h}`,              api: (h) => `https://gitlab.com/api/v4/users?username=${h}` },
  { name: "linktree", url: (h) => `https://linktr.ee/${h}`,               api: (h) => `https://linktr.ee/${h}` },
  { name: "warpcast", url: (h) => `https://warpcast.com/${h}`,            api: (h) => `https://api.warpcast.com/v2/user-by-username?username=${h}` },
];

/* Source budgets (ms). Nothing is allowed to hold the receipt hostage. */
const BUDGET = {
  rpc: 6000, blockscout: 6500, prices: 6000, llama: 6000, x: 7000,
  ens: 5000, osint: 6000, solana: 7000, jev: 3500,
  total: 20000,
};
