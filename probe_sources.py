#!/usr/bin/env python3
"""Probe every candidate data source for COOKED from THIS network line.
Prints one compact line per source: OK/FAIL, ms, snippet.
Run:  python probe_sources.py [wallet] [xhandle]
"""
import json, sys, time, urllib.request, urllib.error, socket
socket.setdefaulttimeout(12)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
W = sys.argv[1] if len(sys.argv) > 1 else "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
X = sys.argv[2] if len(sys.argv) > 2 else "capital_fa"

def get(url, method="GET", body=None, hdrs=None, timeout=12):
    h = {"User-Agent": UA, "Accept": "*/*"}
    if hdrs: h.update(hdrs)
    data = None
    if body is not None:
        data = json.dumps(body).encode() if not isinstance(body, bytes) else body
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    t = time.time()
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        raw = r.read()
        return r.status, (time.time() - t) * 1000, raw
    except urllib.error.HTTPError as e:
        return e.code, (time.time() - t) * 1000, e.read()[:200]
    except Exception as e:
        return "ERR", (time.time() - t) * 1000, str(e).encode()[:120]

def show(name, url, **kw):
    code, ms, raw = get(url, **kw)
    txt = raw.decode("utf-8", "replace").replace("\n", " ")[:170]
    print(f"{'OK ' if code == 200 else 'FAIL'} {name:34s} {str(code):>4s} {ms:7.0f}ms  {txt}")
    return code, raw

print("=" * 100)
print("EVM RPCs (eth_blockNumber)")
print("=" * 100)
RPCS = {
    "eth  nodies": "https://eth-pokt.nodies.app",
    "eth  publicnode": "https://ethereum-rpc.publicnode.com",
    "eth  ankr": "https://rpc.ankr.com/eth",
    "eth  llamarpc": "https://eth.llamarpc.com",
    "eth  drpc": "https://eth.drpc.org",
    "eth  1rpc": "https://1rpc.io/eth",
    "eth  flashbots": "https://rpc.flashbots.net",
    "eth  cloudflare": "https://cloudflare-eth.com",
    "base nodies": "https://base-pokt.nodies.app",
    "base publicnode": "https://base-rpc.publicnode.com",
    "base official": "https://mainnet.base.org",
    "base llamarpc": "https://base.llamarpc.com",
    "bsc  publicnode": "https://bsc-rpc.publicnode.com",
    "bsc  dataseed": "https://bsc-dataseed.binance.org",
    "arb  publicnode": "https://arbitrum-one-rpc.publicnode.com",
    "arb  official": "https://arb1.arbitrum.io/rpc",
    "poly publicnode": "https://polygon-bor-rpc.publicnode.com",
    "poly official": "https://polygon-rpc.com",
}
for n, u in RPCS.items():
    show(n, u, method="POST", body={"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []}, timeout=10)

print()
print("=" * 100)
print("Explorers / token APIs (keyless)")
print("=" * 100)
show("ethplorer freekey", f"https://api.ethplorer.io/getAddressInfo/{W}?apiKey=freekey")
for chain, host in [("eth", "eth.blockscout.com"), ("base", "base.blockscout.com"), ("poly", "polygon.blockscout.com"),
                    ("arb", "arbitrum.blockscout.com"), ("opt", "optimism.blockscout.com"), ("gnosis", "gnosis.blockscout.com")]:
    show(f"blockscout {chain} balances", f"https://{host}/api/v2/addresses/{W}/token-balances")
show("blockscout eth counters", f"https://eth.blockscout.com/api/v2/addresses/{W}/counters")
show("blockscout eth info", f"https://eth.blockscout.com/api/v2/addresses/{W}")
show("blockscout search jup", "https://eth.blockscout.com/api/v2/search?q=USDC")
show("etherscan v2 (nokey)", f"https://api.etherscan.io/v2/api?chainid=1&module=account&action=balance&address={W}")
show("dexscreener token", "https://api.dexscreener.com/latest/dex/tokens/0xdAC17F958D2ee523a2206206994597C13D831ec7")
show("coingecko simple", "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,binancecoin,matic-network&vs_currencies=usd")
show("coingecko ghost", "https://api.coingecko.com/api/v3/coins/ethereum?localization=false&tickers=false&community_data=false&developer_data=false")
show("coinbase spot", "https://api.coinbase.com/v2/prices/ETH-USD/spot")
show("defillama prices", "https://coins.llama.fi/prices/current/coingecko:ethereum")
show("binance ticker", "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT")
show("bybit ticker", "https://api.bybit.com/v5/market/tickers?category=spot&symbol=ETHUSDT")
print()
print("=" * 100)
print("IDENTITY / OSINT (keyless, public)")
print("=" * 100)
show("solana getsupply", "https://api.mainnet-beta.solana.com", method="POST",
     body={"jsonrpc": "2.0", "id": 1, "method": "getSupply", "params": []})
show("ensideas resolve", f"https://api.ensideas.com/ens/resolve/{W}")
show("ensdata reverse", f"https://ensdata.net/{W}")
show("ens metadata avatar", "https://metadata.ens.domains/mainnet/avatar/vitalik.eth")
show("x syndication follow", f"https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names={X}")
show("x syndication timeline", f"https://syndication.twitter.com/srv/timeline-profile/screen-name/{X}")
show("x oembed", f"https://publish.twitter.com/oembed?url=https://twitter.com/{X}&omit_script=1")
show("unavatar twitter", f"https://unavatar.io/twitter/{X}?json")
show("github api user", "https://api.github.com/users/shojaee76-cmyk")
show("github search handle", f"https://api.github.com/search/users?q={X}")
show("telegram page", f"https://t.me/{X}")
show("gravatar check", "https://gravatar.com/avatar/00000000000000000000000000000000.json")
show("dns google", "https://dns.google/resolve?name=shojaee76.workers.dev&type=A")
show("cf doh", "https://cloudflare-dns.com/dns-query?name=example.com&type=A", hdrs={"Accept": "application/dns-json"})
show("rdap org", f"https://rdap.org/ip/{W[:0]}1.1.1.1")
show("ipapi free", "http://ip-api.com/json/1.1.1.1")
show("openrouter models", "https://openrouter.ai/api/v1/models")
print()
print("=" * 100)
print("CONTRACT CODE CHECK (is this address a contract?)")
print("=" * 100)
for n, u in [("eth nodies", "https://eth-pokt.nodies.app"), ("base nodies", "https://base-pokt.nodies.app")]:
    show(f"getCode {n}", u, method="POST", body={"jsonrpc": "2.0", "id": 1, "method": "eth_getCode",
                                                 "params": [W, "latest"]}, timeout=10)
