#!/usr/bin/env python3
"""Probe X-profile sources and extra Blockscout endpoints from this line."""
import json, sys, time, urllib.request, urllib.error, socket
socket.setdefaulttimeout(20)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
def get(url, method="GET", body=None, hdrs=None, timeout=20):
    h = {"User-Agent": UA}
    if hdrs: h.update(hdrs)
    d = None
    if body is not None:
        d = json.dumps(body).encode(); h.setdefault("Content-Type", "application/json")
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, data=d, headers=h, method=method), timeout=timeout)
        raw = r.read(); return r.status, (len(raw)), raw
    except urllib.error.HTTPError as e:
        return e.code, 0, e.read()[:300]
    except Exception as e:
        return "ERR", 0, str(e).encode()[:150]
def show(n, url, **kw):
    c, ln, raw = get(url, **kw)
    t = raw.decode("utf-8", "replace").replace("\n", " ")
    print(f"[{c}] {n}  len={ln}\n    {t[:600]}\n")
for h in ["capital_fa", "elonmusk"]:
    show(f"syndication followbutton {h}", f"https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names={h}")
show("syndication timeline elon", "https://syndication.twitter.com/srv/timeline-profile/screen-name/elonmusk")
show("jina r.jina.ai x profile", "https://r.jina.ai/https://x.com/capital_fa", hdrs={"X-Return-Format": "text"})
W = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
show("blockscout base balances retry", f"https://base.blockscout.com/api/v2/addresses/{W}/token-balances")
show("blockscout base counters", f"https://base.blockscout.com/api/v2/addresses/{W}/counters")
show("blockscout poly counters", f"https://polygon.blockscout.com/api/v2/addresses/{W}/counters")
show("blockscout arb counters", f"https://arbitrum.blockscout.com/api/v2/addresses/{W}/counters")
show("blockscout opt counters", f"https://optimism.blockscout.com/api/v2/addresses/{W}/counters")
show("blockscout eth nft", f"https://eth.blockscout.com/api/v2/addresses/{W}/nft?type=ERC-721%2CERC-404%2CERC-1155")
show("blockscout ens domains", f"https://eth.blockscout.com/api/v2/addresses/{W}/domains")
