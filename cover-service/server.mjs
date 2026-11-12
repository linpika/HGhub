// Required Notice: Copyright (c) 2026 HGhub contributors (https://github.com/Minireel/HGhub)
// License: PolyForm Noncommercial 1.0.0
// https://polyformproject.org/licenses/noncommercial/1.0.0
//
// 只提供已批准的演示图。HGhub 密文封面适配器未接入，这里没有解密密钥。
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { demoPng } from "./png.mjs";

const DEMO = Object.freeze({ id: "demo", bytes: demoPng(), type: "image/png" });

export function createCoverApp(options = {}) {
  const secret = options.secret;
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error("COVER_SIGNING_SECRET must be provided at runtime");
  }
  const now = options.now || (() => Date.now());
  const maxTtlSec = options.maxTtlSec || 120;
  const cacheTtlMs = options.cacheTtlMs || 60_000;
  const cacheMax = options.cacheMax || 8;
  const rateMax = options.rateMax || 30;
  const rateWindowMs = options.rateWindowMs || 60_000;
  const outbound = options.outbound || (() => {
    throw new Error("outbound fetch is not enabled");
  });
  const cache = new Map();
  const rates = new Map();
  const loads = new Map();

  function text(status, message) {
    return { status, type: "text/plain; charset=utf-8", body: Buffer.from(message) };
  }

  function allow(ip, t) {
    const bucket = rates.get(ip);
    if (!bucket || t >= bucket.reset) {
      rates.set(ip, { count: 1, reset: t + rateWindowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= rateMax;
  }

  function signature(id, exp) {
    return createHmac("sha256", secret).update(`GET\n/v1/${id}.png\n${exp}`).digest();
  }

  function authorized(id, expRaw, sigRaw, t) {
    if (!/^[1-9]\d{0,10}$/.test(expRaw || "")) return false;
    const exp = Number(expRaw);
    const nowSec = Math.floor(t / 1000);
    if (exp <= nowSec || exp > nowSec + maxTtlSec) return false;
    let given;
    try { given = Buffer.from(sigRaw || "", "base64url"); } catch { return false; }
    const expected = signature(id, expRaw);
    if (given.length !== expected.length) return false;
    return timingSafeEqual(given, expected);
  }

  function fromCache(id, t) {
    const hit = cache.get(id);
    if (!hit) return null;
    if (hit.exp <= t) {
      cache.delete(id);
      return null;
    }
    return hit;
  }

  function store(id, src, t) {
    if (cache.size >= cacheMax && !cache.has(id)) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(id, { body: src.bytes, type: src.type, exp: t + cacheTtlMs });
  }

  function approved(id) {
    if (id !== DEMO.id) return null;
    loads.set(id, (loads.get(id) || 0) + 1);
    return DEMO;
  }

  async function handle(req, ip = "local") {
    const t = now();
    if (!allow(ip, t)) return text(429, "rate limited");
    let url;
    try { url = new URL(req.url, "http://127.0.0.1"); } catch { return text(400, "bad request"); }
    const match = /^\/v1\/([a-z0-9-]{1,32})\.png$/.exec(url.pathname);
    if (!match) return text(404, "not found");
    const id = match[1];
    if ([...url.searchParams.keys()].some((key) => key !== "exp" && key !== "sig")) {
      return text(400, "unsupported query");
    }
    if (!authorized(id, url.searchParams.get("exp"), url.searchParams.get("sig"), t)) {
      return text(403, "forbidden");
    }
    const hit = fromCache(id, t);
    if (hit) return { status: 200, type: hit.type, body: hit.body, cache: "hit" };
    const src = approved(id);
    if (!src) return text(404, "not approved");
    store(id, src, t);
    return { status: 200, type: src.type, body: src.bytes, cache: "miss" };
  }

  return {
    handle,
    outbound,
    loads: () => new Map(loads),
    sign(id, ttlSec = 60, origin = "https://cover.example") {
      const ttl = Math.min(Math.max(1, ttlSec), maxTtlSec);
      const exp = String(Math.floor(now() / 1000) + ttl);
      const sig = signature(id, exp).toString("base64url");
      return `${origin.replace(/\/$/, "")}/v1/${id}.png?exp=${exp}&sig=${sig}`;
    },
  };
}

export function listen(app, port = 0) {
  const server = createServer(async (req, res) => {
    const result = await app.handle(req, req.socket.remoteAddress || "local");
    res.writeHead(result.status, {
      "Content-Type": result.type,
      "Cache-Control": result.status === 200 ? "private, max-age=60" : "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(result.body);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const secret = process.env.COVER_SIGNING_SECRET;
  const app = createCoverApp({ secret });
  const port = Number(process.env.PORT || 8787);
  listen(app, port).then((server) => {
    const address = server.address();
    console.log(`cover service listening on 127.0.0.1:${address.port}`);
  });
}
