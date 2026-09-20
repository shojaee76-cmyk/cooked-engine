#!/usr/bin/env python3
"""COOKED acceptance harness. Exercises the engine against the local Node host
(the identical bundle that ships) and asserts the honesty invariants.

    python tools/verify_engine.py                 # against http://localhost:8787
    python tools/verify_engine.py --url https://cooked.shojaee76.workers.dev
    python tools/verify_engine.py --show vitalik  # print one full receipt
"""
import argparse, json, os, re, sys, time, urllib.error, urllib.request

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
UA = {"User-Agent": "Mozilla/5.0 cooked-verify", "Content-Type": "application/json"}
fails, warns = [], []


def post(url, body, timeout=180):
    req = urllib.request.Request(url + "/api/roast", data=json.dumps(body).encode(), headers=UA, method="POST")
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read()), time.time() - t
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw), time.time() - t
        except Exception:
            return e.code, {"raw": raw[:200].decode(errors="replace")}, time.time() - t


def check(cond, msg):
    if not cond:
        fails.append(msg)
    return cond


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
    return


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8787")
    ap.add_argument("--show", default=None, help="substring of a subject to print in full")
    a = ap.parse_args()
    print(f"target: {a.url}\n")
    for name, body in SUBJECTS:
        st, d, dt = post(a.url, body)
        invariants(name, d, st)
        if st == 200 and d.get("ok"):
            rec = d.get("receipt", [])
            print(f"[{st}] {name:18s} {dt:6.1f}s  {d['archetype']['id']:16s} rekt={d['score']['rekt']:>3}/{d['score']['level']:<10} "
                  f"lines={len(rec)} basis={d['score'].get('basis')} jev={'on' if (d.get('jev') or {}).get('used') else 'off'} "
                  f"src={sum(1 for c in d['coverage'] if c['ok'])}/{len(d['coverage'])}")
            if a.show and a.show in name:
                print("\n" + "=" * 74)
                print(f"RECEIPT  {d['subject']['label']}  wallet={'yes' if d['input']['wallet'] else 'no'}  {d['archetype']['name']}")
                print("=" * 74)
                for f in rec:
                    print(f"  [{f['tag']:<14}] {f['text']}")
                print(f"  NET WORTH {d['chain'].get('net_worth_usd')}  TOKENS {d['chain'].get('token_count')} "
                      f"REKT {d['score']['rekt']}/100 {d['score']['level']}")
                for c in d["score"]["components"]:
                    print(f"    {c['label']:<12} {str(c['value']):>5}  weight {c['weight']}")
                print(f"  VERDICT: {d['verdict']}")
                print(f"  {d['data_truth']['note']}")
                print("=" * 74 + "\n")
        else:
            print(f"[{st}] {name:18s} {dt:6.1f}s  error: {str(d.get('error') or d)[:90]}")
    print()
    for w in warns:
        print("WARN:", w)
    for f in fails:
        print("FAIL:", f)
    print(f"\n{len(SUBJECTS)} subjects | {len(fails)} failures | {len(warns)} warnings")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
