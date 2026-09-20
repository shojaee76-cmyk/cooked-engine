#!/usr/bin/env python3
"""COOKED build: assemble the engine, the joke bank, the fonts and the page into
one deployable Worker, plus a Node server that runs the identical code locally.

    python build.py            # build ./dist
    python build.py --check    # build, then static sanity gates only

Design rule: the same bundle runs on Cloudflare and on Node, so local
verification actually tests the artifact that ships.
"""
import base64, hashlib, json, os, re, sys, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
FRONT = ROOT / "front" / "index.html"
PUNCH = ROOT / "punchlines"
ASSETS = ROOT / "assets"
DIST = ROOT / "dist"

ORDER = ["00_punchlines.js", "10_config.js", "20_sources.js", "30_engine.js"]

FONTS = {
    "F_D":  ("barlow-condensed-800.woff2",
             "https://unpkg.com/@fontsource/barlow-condensed/files/barlow-condensed-latin-800-normal.woff2",
             [ROOT.parent / "persian-guide/assets/fonts/ArchivoBlack-Regular.woff2"]),
    "F_M":  ("azeret-mono-400.woff2",
             "https://unpkg.com/@fontsource/azeret-mono/files/azeret-mono-latin-400-normal.woff2",
             [ROOT.parent / "persian-guide/assets/fonts/IBMPlexMono-Regular.woff2"]),
    "F_MB": ("azeret-mono-700.woff2",
             "https://unpkg.com/@fontsource/azeret-mono/files/azeret-mono-latin-700-normal.woff2",
             [ROOT.parent / "persian-guide/assets/fonts/IBMPlexMono-SemiBold.woff2"]),
}
QR_URL = "https://unpkg.com/qrcode-generator@1.4.4/qrcode.js"

ARCH_IDS = ["empty_wallet", "dust_collector", "silent_holder", "whale_no_taste", "stable_maxi",
            "exit_liquidity", "degen_churner", "airship_hopeful", "ghost_account", "farming_bot",
            "vesting_survivor", "contract_entity", "x_absent", "x_ghost", "x_lurker",
            "x_broadcaster", "x_brand_account", "x_commentator"]

warnings, errors = [], []


def fetch(url, dest, fallbacks=()):
    """Cache every external asset on disk so rebuilds are offline and identical."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        return dest.read_bytes()
    for u in (url, *fallbacks):
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 cooked-build"})
            with urllib.request.urlopen(req, timeout=45) as r:
                data = r.read()
            if len(data) > 500:
                dest.write_bytes(data)
                print(f"  fetched {dest.name} ({len(data)}B) from {u.split('/')[2]}")
                return data
        except Exception as e:
            print(f"  fetch failed {u[:60]}: {str(e)[:60]}")
    if dest.exists():
        return dest.read_bytes()
    raise SystemExit(f"could not obtain asset {dest.name}")


# ---------------------------------------------------------------- joke bank
def load_bank():
    by_id, tags, verdicts, desc, tiers = {}, {}, [], {}, {}
    files = sorted(PUNCH.glob("*.json"))
    if not files:
        warnings.append("no punchline files found: receipts will fall back to built-in lines")
    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            errors.append(f"{f.name}: unreadable JSON ({e})")
            continue
        if isinstance(data, dict):
            data = data.get("lines") or data.get("punchlines") or data.get("entries") or []
        n = 0
        for e in data:
            if not isinstance(e, dict) or not e.get("text"):
                continue
            eid = str(e.get("id") or "").strip()
            text = clean_text(str(e["text"]))
            if not eid:
                continue
            tier = e.get("tier") or "medium"
            if eid == "verdict":
                verdicts.append({"text": text, "tier": tier}); n += 1; continue
            if eid in ARCH_IDS:
                desc.setdefault(eid, []).append({"text": text, "tier": tier}); n += 1; continue
            item = {"text": text, "slots": e.get("slots") or [], "device": e.get("device"),
                    "weight": e.get("weight"), "tier": e.get("tier") or "medium",
                    "archetypes": e.get("archetypes") or []}
            by_id.setdefault(eid, []).append(item)
            if e.get("tag"):
                tags.setdefault(eid, e["tag"])
            n += 1
            tiers[tier] = tiers.get(tier, 0) + 1
        print(f"  {f.name}: {n} entries")
    by_id = {k: v for k, v in by_id.items() if v}
    return {"byId": by_id, "tags": tags, "verdicts": verdicts, "archetypeDesc": desc, "tiers": tiers}


def clean_text(s):
    """House rules enforced at build time, so a bad line cannot ship."""
    s = s.strip().replace("\u2014", ",").replace("\u2013", "-")
    s = re.sub(r"\s+", " ", s)
    if "\u2014" in s:
        errors.append("em dash survived cleaning")
    return s


# Words a roast may never use. The writers' own checklist says "the attack is on behaviour, not
# identity", and this makes that a build failure instead of a good intention: identity, body,
# family, faith and health are out of bounds, and slurs are never a punchline.
BANNED = [
    r"retard\w*", r"spastic", r"autis\w*", r"down'?s syndrome", r"midget", r"cripple",
    r"nigger", r"nigga", r"faggot", r"tranny", r"gypsy", r"chink", r"kike", r"wetback", r"spic",
    r"\bugly\b", r"\bfat\b", r"fatso", r"\bbalding\b", r"\bacne\b", r"\bteeth\b", r"\btoothless\b",
    r"your (mother|mom|mum|wife|husband|daughter|son|kid|kids|children|family|parents)",
    r"\bcancer\b", r"\bhiv\b", r"\baids\b", r"\bsuicide\b", r"\bkys\b", r"kill yourself",
    r"\bdisabled\b", r"\bblind\b", r"\bdeaf\b", r"\bwheelchair\b",
    r"\bjew\w*\b", r"\bmuslim\w*\b", r"\bchristian\w*\b", r"\bhindu\w*\b",
    r"\barab\w*\b", r"\biranian\w*\b", r"\bpersian\w*\b", r"\bafrican\w*\b",
    r"\bchinese\b", r"\bindian\b", r"\bmexican\b", r"\bwoman\b", r"\bwomen\b", r"\bgirl\b",
    r"\bgay\b", r"\blesbian\b", r"\btrans\b", r"\breligion\b",
]


def identity_guard(bank):
    """Refuse to ship a line that attacks who somebody is instead of what they did."""
    hits = []
    for fid, variants in bank["byId"].items():
        for v in variants:
            low = v["text"].lower()
            for pat in BANNED:
                if re.search(pat, low):
                    hits.append((fid, pat, v["text"][:90]))
    for fid, entries in bank.get("archetypeDesc", {}).items():
        for e in entries:
            for pat in BANNED:
                if re.search(pat, e["text"].lower()):
                    hits.append((f"archetype:{fid}", pat, e["text"][:90]))
    for i, e in enumerate(bank.get("verdicts", [])):
        for pat in BANNED:
            if re.search(pat, e["text"].lower()):
                hits.append((f"verdict:{i}", pat, e["text"][:90]))
    return hits


def bank_report(bank):
    ids = sorted(bank["byId"].keys())
    total = sum(len(v) for v in bank["byId"].values())
    tiers = bank.get("tiers", {})
    print(f"  facts with lines: {len(ids)}   lines: {total}   verdicts: {len(bank['verdicts'])}   archetype descs: {len(bank['archetypeDesc'])}")
    if tiers:
        print("  register mix: " + ", ".join(f"{k} {v}" for k, v in sorted(tiers.items(), key=lambda x: -x[1])))
    brutal = [fid for fid, vs in bank["byId"].items() if any(v["tier"] == "brutal" for v in vs)]
    print(f"  facts with a BRUTAL line: {len(brutal)}/{len(ids)}")
    return ids


# ---------------------------------------------------------------- the front
def build_html():
    html = FRONT.read_text(encoding="utf-8")
    for key, (fname, url, fb) in FONTS.items():
        data = fetch(url, ASSETS / fname, tuple(str(x) for x in fb))
        b64 = base64.b64encode(data).decode()
        token = f"/*__{key}__*/"
        if token not in html:
            errors.append(f"font placeholder {token} missing from index.html")
            continue
        html = html.replace(token, b64)
    qr = fetch(QR_URL, ASSETS / "qrcode.js").decode("utf-8", "replace")
    if "qrcode" not in qr:
        errors.append("QR library looks wrong")
    html = html.replace("<script>\nconst $ =", "<script>" + qr + "</script>\n<script>\nconst $ =", 1)
    return html


# ----------------------------------------------------------------- assem bly
def main():
    DIST.mkdir(exist_ok=True)
    rev = time.strftime("%Y%m%d-%H%M%S")
    fhash = hashlib.sha256()

    print("== assets ==")
    page = build_html()

    print("== joke bank ==")
    bank = load_bank()
    ids = bank_report(bank)

    # gate: every bank line that uses a slot must declare it, and every declared slot must be used
    for fid, variants in bank["byId"].items():
        for v in variants:
            used = set(re.findall(r"\{(\w+)\}", v["text"]))
            decl = set(v["slots"] or [])
            if used - decl:
                warnings.append(f"{fid}: line uses undeclared slot(s) {sorted(used - decl)}")
            if len(v["text"]) > 240:
                warnings.append(f"{fid}: line is {len(v['text'])} chars, too long for the paper")

    blocked = identity_guard(bank)
    if blocked:
        for fid, pat, text in blocked:
            errors.append(f"{fid}: identity attack (/{pat}/) -> {text}")
    else:
        print("  identity guard: clean (no line attacks who somebody is)")

    parts = []
    for name in ORDER:
        f = SRC / name
        if not f.exists():
            raise SystemExit(f"missing source {name}")
        body = f.read_text(encoding="utf-8")
        if name == "00_punchlines.js":
            body = body.replace("/*__BANK__*/{}", "/*__BANK__*/" + json.dumps(bank, ensure_ascii=False), 1)
        parts.append(f"/* ==== {name} ==== */\n{body}\n")

    worker_src = (SRC / "40_worker.js").read_text(encoding="utf-8")
    page_mod = ("/* ==== generated: page + revision ==== */\n"
                f"const REV = {json.dumps(rev)};\n"
                f"const PAGE_HTML = {json.dumps(page)};\n")

    bundle = "\n".join(parts) + page_mod
    entry = bundle + "\n" + worker_src + """
/* Cloudflare Workers module entry */
export default { async fetch(request, env, ctx) { return handleRequest(request, env, ctx); } };
"""
    (DIST / "bundle.js").write_text(bundle, encoding="utf-8", newline="\n")
    (DIST / "worker.js").write_text(entry, encoding="utf-8", newline="\n")
    (DIST / "index.html").write_text(page, encoding="utf-8", newline="\n")
    (DIST / "punchlines.json").write_text(json.dumps(bank, ensure_ascii=False, indent=1), encoding="utf-8")
    (DIST / "package.json").write_text('{"name":"cooked-local","private":true,"type":"module"}\n', encoding="utf-8")

    (DIST / "local_server.js").write_text("""/* Node host for the exact bundle that ships to Cloudflare. */
import http from "node:http";
import { readFileSync } from "node:fs";
import worker from "./worker.js";
const PORT = process.env.PORT || 8787;
const env = { JEV_KEY: process.env.JEV_KEY || null, JEV_MODEL: process.env.JEV_MODEL || null, DEV: process.env.COOKED_DEV === "1" ? "1" : null };
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const request = new Request(url, { method: req.method, headers: req.headers, body });
  try {
    const out = await worker.fetch(request, env, {});
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  }
});
server.listen(PORT, () => console.log(`COOKED local server on http://localhost:${PORT}  (jev: ${env.JEV_KEY ? "on" : "off"})`));
""", encoding="utf-8", newline="\n")

    fhash.update(entry.encode())
    print("\n== built ==")
    for f in ["worker.js", "bundle.js", "index.html", "punchlines.json"]:
        print(f"  dist/{f:16s} {os.path.getsize(DIST / f):>9,d} B")
    print(f"  rev {rev}  sha256 {fhash.hexdigest()[:16]}")
    if errors:
        print("\nERRORS:")
        for e in errors:
            print("  -", e)
        return 1
    if warnings:
        print(f"\nwarnings ({len(warnings)}):")
        for w in warnings[:12]:
            print("  -", w)
    # real fact ids, not archetype names: this check used to report a false gap every build
    wanted = ["total_usd", "broke", "dust", "unpriced", "gas_burner_abs", "dead_holders",
              "no_ens", "ratio", "engagement", "x_summary"]
    missing = [i for i in wanted if i not in ids]
    if missing:
        print("  note: no lines yet for", ", ".join(missing))
    else:
        print("  bank covers every core fact")
    return 0


if __name__ == "__main__":
    sys.exit(main())
