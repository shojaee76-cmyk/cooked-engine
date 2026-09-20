/* Node host for the exact bundle that ships to Cloudflare. */
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
