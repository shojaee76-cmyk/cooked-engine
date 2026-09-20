#!/usr/bin/env python3
"""COOKED deploy: build, then push to Cloudflare Workers.

    python deploy.py            # build + deploy + live verify
    python deploy.py --no-build # deploy ./dist as it stands

Token resolution: $CLOUDFLARE_API_TOKEN, then ./cf_token.txt, then the token
already used by the bpb-wizard deploy script.
The OpenRouter key becomes a Worker secret (never shipped to the browser).
"""
import argparse, json, os, re, ssl, subprocess, sys, time, urllib.error, urllib.request, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAME = "cooked"
VARS = {"JEV_MODEL": "~typesafe/jev-latest"}
BASE = "https://api.cloudflare.com/client/v4"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # dead proxy vars must never hijack this


def token():
    t = os.environ.get("CLOUDFLARE_API_TOKEN")
    if t:
        return t.strip()
    f = ROOT / "cf_token.txt"
    if f.exists():
        return f.read_text(encoding="utf-8").strip()
    bp = ROOT.parent / "bpb-wizard" / "deploy_bpb.py"
    if bp.exists():
        m = re.search(r'TOKEN\s*=\s*"([^"]+)"', bp.read_text(encoding="utf-8"))
        if m:
            return m.group(1)
    raise SystemExit("no Cloudflare API token (env CLOUDFLARE_API_TOKEN, ./cf_token.txt, or bpb-wizard/deploy_bpb.py)")


def jev_key():
    p = Path(os.environ.get("LOCALAPPDATA", "")) / "hermes" / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.strip().startswith("OPENROUTER_API_KEY="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("OPENROUTER_API_KEY")


def call(method, path, body=None, headers=None, retries=3, timeout=120):
    url = path if path.startswith("http") else BASE + path
    data = None
    h = {"Authorization": "Bearer " + TOKEN}
    if headers:
        h.update(headers)
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        h.setdefault("Content-Type", "application/json")
    last = None
    for attempt in range(1, retries + 1):
        try:
            with opener.open(urllib.request.Request(url, data=data, headers=h, method=method), timeout=timeout) as r:
                raw = r.read()
            try:
                return json.loads(raw)
            except Exception:
                return {"raw": raw[:400].decode(errors="replace")}
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                j = json.loads(raw)
            except Exception:
                j = {"raw": raw[:400].decode(errors="replace")}
            last = RuntimeError(f"{method} {path} -> HTTP {e.code}: {json.dumps(j)[:400]}")
            if 400 <= e.code < 500 and e.code != 429:
                break
        except Exception as e:
            last = RuntimeError(f"{method} {path} -> {e}")
        time.sleep(2 * attempt)
    raise last


TOKEN = token()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-build", action="store_true")
    a = ap.parse_args()

    if not a.no_build:
        print("== build ==")
        rc = subprocess.call([sys.executable, str(ROOT / "build.py")])
        if rc != 0:
            raise SystemExit("build failed, not deploying")

    script = (ROOT / "dist" / "worker.js").read_text(encoding="utf-8")
    print(f"== worker script: {len(script):,d} chars ==")

    print("== account ==")
    accs = call("GET", "/accounts").get("result") or []
    if not accs:
        raise SystemExit("token sees no accounts")
    for x in accs:
        print("  ", x.get("id"), x.get("name"))
    ACC = accs[0]["id"]

    sub = (call("GET", f"/accounts/{ACC}/workers/subdomain").get("result") or {}).get("subdomain")
    print("== workers.dev subdomain:", sub)
    if not sub:
        sub = "shojaee76"
        call("PUT", f"/accounts/{ACC}/workers/subdomain", {"subdomain": sub})
        print("  set to", sub)

    print("== kv namespace ==")
    ns = None
    for n in (call("GET", f"/accounts/{ACC}/storage/kv/namespaces?per_page=100").get("result") or []):
        if n.get("title") == "cooked-kv":
            ns = n["id"]
    if not ns:
        r = call("POST", f"/accounts/{ACC}/storage/kv/namespaces", {"title": "cooked-kv"})
        ns = (r.get("result") or {}).get("id")
        print("  created", ns)
    else:
        print("  existing", ns)
    if not ns:
        raise SystemExit("no kv namespace")

    print("== upload ==")
    meta = {
        "main_module": "worker.js",
        "compatibility_date": time.strftime("%Y-%m-%d"),
        "bindings": [
            {"type": "kv_namespace", "name": "COOKED_KV", "namespace_id": ns},
            *[{"type": "plain_text", "name": k, "text": v} for k, v in VARS.items()],
        ],
    }
    b = "----COOKED" + uuid.uuid4().hex

    def part(name, filename, ctype, content):
        h = f'--{b}\r\nContent-Disposition: form-data; name="{name}"'
        if filename:
            h += f'; filename="{filename}"'
        h += f"\r\nContent-Type: {ctype}\r\n\r\n"
        return h.encode() + (content if isinstance(content, bytes) else content.encode()) + b"\r\n"

    body = part("metadata", None, "application/json", json.dumps(meta))
    body += part("worker.js", "worker.js", "application/javascript+module", script)
    body += f"--{b}--\r\n".encode()
    r = call("PUT", f"/accounts/{ACC}/workers/scripts/{NAME}", body=body,
             headers={"Content-Type": f"multipart/form-data; boundary={b}"}, retries=4, timeout=240)
    print("  upload success:", r.get("success"))
    if not r.get("success"):
        print(json.dumps(r)[:800])
        raise SystemExit("upload failed")

    k = jev_key()
    if k:
        import hashlib
        sd = hashlib.sha256(k.encode()).hexdigest()[:8] if False else None
        r = call("PUT", f"/accounts/{ACC}/workers/scripts/{NAME}/secrets",
                 {"name": "JEV_KEY", "text": k, "type": "secret_text"}, retries=2)
        print("  secret set:", r.get("success"), "(key ends ...%s)" % k[-4:])
    else:
        print("  WARNING: no OPENROUTER_API_KEY found, Jev layer will report 'no key configured'")

    print("== route ==")
    r = call("POST", f"/accounts/{ACC}/workers/scripts/{NAME}/subdomain",
             {"enabled": True, "previews_enabled": False})
    print("  routing:", r.get("success"))

    url = f"https://{NAME}.{sub}.workers.dev"
    print("== live verify ==")
    ok = False
    for i in range(8):
        try:
            with opener.open(urllib.request.Request(url + "/health", headers={"User-Agent": "curl/8"}), timeout=45) as r2:
                txt = r2.read(400).decode(errors="replace")
                print(f"  try {i+1}: HTTP {r2.status} {txt[:160]}")
                if r2.status == 200 and '"ok":true' in txt.replace(" ", ""):
                    ok = True
                    break
        except urllib.error.HTTPError as e:
            print(f"  try {i+1}: HTTP {e.code}")
        except Exception as e:
            print(f"  try {i+1}: {str(e)[:120]}")
        time.sleep(7)
    (ROOT / "deploy_url.txt").write_text(url + "\n", encoding="utf-8")
    print("\nDEPLOYED:", url, "| healthy:", ok)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
