/* ============================================================================
   COOKED — worker: routing, cache, rate limit, honest errors.
   Same code runs as a Cloudflare Worker and as the local Node server.
   ========================================================================== */

const DEFAULT_JEV_MODEL = "~typesafe/jev-latest";
const RATE = { evm: 16, handle: 30, windowMin: 10, dailyCap: 4000 };
const TTL_SECONDS = 900;

/* ---- storage: KV on Cloudflare, a Map locally. Same interface either way. */
const _mem = new Map();
function store(env) {
  const kv = env && env.COOKED_KV ? env.COOKED_KV : null;
  return {
    async get(k) {
      if (kv) { const v = await kv.get(k); return v ? JSON.parse(v) : null; }
      const e = _mem.get(k);
      if (!e || e.exp < Date.now()) { _mem.delete(k); return null; }
      return e.v;
    },
    async put(k, v, ttl) {
      if (kv) return kv.put(k, JSON.stringify(v), { expirationTtl: ttl });
      _mem.set(k, { v, exp: Date.now() + ttl * 1000 });
      if (_mem.size > 400) { const first = _mem.keys().next().value; _mem.delete(first); }
    },
  };
}

function clientIp(req) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "local";
}

async function rateLimit(env, ip, kind) {
  if (env && env.DEV) return { ok: true };   /* local harness only, never set in production */
  const db = store(env);
  const windowKey = `rl:${ip}`;
  const limit = kind === "evm" ? RATE.evm : RATE.handle;
  const now = Date.now();
  const rec = (await db.get(windowKey)) || { hits: [] };
  rec.hits = (rec.hits || []).filter((t) => now - t < RATE.windowMin * 60000);
  if (rec.hits.length >= limit) {
    const oldest = rec.hits[0];
    return { ok: false, retry_after: Math.ceil((RATE.windowMin * 60000 - (now - oldest)) / 1000) };
  }
  rec.hits.push(now);
  await db.put(windowKey, rec, RATE.windowMin * 60 + 60);

  const dayKey = `cap:${new Date().toISOString().slice(0, 10)}`;
  const cap = (await db.get(dayKey)) || { n: 0 };
  if (cap.n >= RATE.dailyCap) return { ok: false, retry_after: 3600, cap: true };
  cap.n += 1;
  await db.put(dayKey, cap, 90000);
  return { ok: true };
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function detectKind(wallet) {
  if (!wallet) return "none";
  if (/^0x[0-9a-fA-F]{40}$/.test(wallet)) return "evm";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return "solana";
  return "bad";
}

async function handleRequest(request, env = {}, ctx = null) {
  const url = new URL(request.url);
  _cov.length = 0;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type" } });
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    return new Response(PAGE_HTML, { headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=120",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    } });
  }

  if (url.pathname === "/health") {
    return json({ ok: true, service: "cooked", rev: REV, jev: !!(env && env.JEV_KEY) });
  }

  if (url.pathname !== "/api/roast") return json({ ok: false, error: "nothing here. try /" }, 404);
  if (request.method === "GET") {
    return json({ ok: false, error: "POST a wallet or a handle to /api/roast. GET prints nothing." }, 405);
  }
  if (request.method !== "POST") return json({ ok: false, error: "POST only." }, 405);

  let body = {};
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "Send JSON: {\"wallet\":\"0x…\",\"handle\":\"…\"}" }, 400); }

  const handleRaw = String((body.handle != null ? body.handle : body.x) == null ? "" : (body.handle != null ? body.handle : body.x)).trim().replace(/^@/, "").slice(0, 40);
  const handle = /^[A-Za-z0-9_]{1,15}$/.test(handleRaw) ? handleRaw : "";
  const wallet = String(body.wallet == null ? "" : body.wallet).trim().slice(0, 60);
  const salt = String(body.salt == null ? "" : body.salt).slice(0, 16);
  const heat = Math.min(3, Math.max(1, Number(body.heat) || 3));
  const kind = detectKind(wallet);

  if (!wallet && !handle) return json({ ok: false, error: "Give me a wallet, or at least a handle." }, 400);
  if (wallet && kind === "bad") {
    return json({ ok: false, error: "That is not an address. EVM is 0x + 40 hex characters, Solana is a base58 address." }, 400);
  }

  const cacheKey = `r:${(wallet || "-").toLowerCase()}|${(handle || "-").toLowerCase()}|${salt}|h${heat}`;
  const db = store(env);
  /* Cache first: a reload, a share link or a REPRINT costs nothing upstream, so it
     must not consume the visitor's rate budget. Only a real read counts. */
  if (!salt) {
    const hit = await db.get(cacheKey);
    if (hit) return json({ ...hit, cached: true });
  }

  const rl = await rateLimit(env, clientIp(request), kind === "evm" ? "evm" : "handle");
  if (!rl.ok) {
    return json({ ok: false, error: rl.cap
      ? "The printer has hit its daily paper budget. Come back tomorrow."
      : "Slow down. The printer is one machine and you are not the only customer.",
      retry_after: rl.retry_after }, 429, { "Retry-After": String(rl.retry_after) });
  }

  let out;
  try {
    out = await cook({ wallet: kind === "evm" ? wallet.toLowerCase() : wallet, handle, kind, salt, heat }, {
      bank: PUNCHLINES,
      jevKey: (env && env.JEV_KEY) || null,
      jevModel: (env && env.JEV_MODEL) || DEFAULT_JEV_MODEL,
    });
  } catch (err) {
    return json({ ok: false, error: "The engine jammed: " + String((err && err.message) || err).slice(0, 140), coverage: _cov }, 500);
  }

  if (!out.receipt.length) {
    out.data_truth.note += " Not enough was readable to print a roast, so the paper stays blank rather than insulting nobody.";
  }
  out.receipt_id = "ck_" + (rng(cacheKey).toString(36).slice(2, 8) + Math.abs(hashStr(cacheKey)).toString(36)).slice(0, 8);
  out.cached = false;
  if (ctx && ctx.waitUntil) ctx.waitUntil(db.put(cacheKey, out, TTL_SECONDS));
  else await db.put(cacheKey, out, TTL_SECONDS);
  return json(out);
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}
