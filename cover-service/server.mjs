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
const RATE_MAX_KEYS = 1024;

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
  const rateMaxKeys = options.rateMaxKeys || RATE_MAX_KEYS;
  const trustedProxies = new Set((options.trustedProxies || []).map(normalizeIp).filter(Boolean));
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
      if (!bucket && rates.size >= rateMaxKeys) rates.delete(rates.keys().next().value);
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
    if (!/^[1-9][0-9]{0,10}$/.test(expRaw)) return false;
    if (!/^[A-Za-z0-9_-]{43,44}$/.test(sigRaw)) return false;
    const exp = Number(expRaw);
    const nowSec = Math.floor(t / 1000);
    if (exp <= nowSec || exp > nowSec + maxTtlSec) return false;
    const given = Buffer.from(sigRaw, "base64url");
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
    if (cache.size >= cacheMax && !cache.has(id)) cache.delete(cache.keys().next().value);
    cache.set(id, { body: src.bytes, type: src.type, exp: t + cacheTtlMs });
  }

  function approved(id) {
    if (id !== DEMO.id) return null;
    loads.set(id, (loads.get(id) || 0) + 1);
    return DEMO;
  }

  function clientIp(peer, headers) {
    const normalized = normalizeIp(peer) || "unknown";
    if (!trustedProxies.has(normalized)) return normalized;
    const forwarded = headers["x-forwarded-for"];
    if (typeof forwarded !== "string" || forwarded.includes(",")) return normalized;
    const candidate = normalizeIp(forwarded.trim());
    return candidate || normalized;
  }

  async function handle(req, peerIp) {
    const t = now();
    const headers = req.headers || {};
    const ip = clientIp(peerIp || req.socket?.remoteAddress, headers);
    if (!allow(ip, t)) return text(429, "rate limited");
    const raw = req.url || "";
    const cut = raw.indexOf("?");
    const rawPath = cut === -1 ? raw : raw.slice(0, cut);
    const rawQuery = cut === -1 ? "" : raw.slice(cut + 1);
    if (rawPath === "/healthz" && rawQuery === "") return text(200, "ok");
    if (rawPath.includes("%") || rawPath.includes("//") || rawPath.includes("..") || !rawPath.startsWith("/")) {
      return text(400, "bad path");
    }
    const match = /^\/v1\/([a-z0-9-]{1,32})\.png$/.exec(rawPath);
    if (!match) return text(404, "not found");
    const id = match[1];
    if (rawQuery === "") return text(403, "forbidden");
    const query = parseQuery(rawQuery);
    if (!query) return text(400, "bad query");
    if (!authorized(id, query.exp, query.sig, t)) return text(403, "forbidden");
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
    rateSize: () => rates.size,
    sign(id, ttlSec = 60, origin) {
      if (!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(origin || "")) {
        throw new Error("COVER_PUBLIC_ORIGIN must be an https origin");
      }
      const ttl = Math.min(Math.max(1, ttlSec), maxTtlSec);
      const exp = String(Math.floor(now() / 1000) + ttl);
      const sig = signature(id, exp).toString("base64url");
      return `${origin}/v1/${id}.png?exp=${exp}&sig=${sig}`;
    },
  };
}

function parseQuery(raw) {
  if (!raw) return null;
  const found = new Map();
  for (const part of raw.split("&")) {
    if (!part || part.includes("%") || !/^(exp|sig)=[A-Za-z0-9_-]+$/.test(part)) return null;
    const eq = part.indexOf("=");
    const key = part.slice(0, eq);
    if (found.has(key)) return null;
    found.set(key, part.slice(eq + 1));
  }
  if (found.size !== 2) return null;
  return { exp: found.get("exp"), sig: found.get("sig") };
}

function normalizeIp(value) {
  if (typeof value !== "string") return "";
  const text = value.trim().toLowerCase();
  if (!text || text.length > 64 || /[^0-9a-f:.]/.test(text)) return "";
  return text.startsWith("::ffff:") ? text.slice(7) : text;
}

export function listen(app, port = 0) {
  const server = createServer((req, res) => {
    req.setTimeout(5_000, () => req.destroy());
    Promise.resolve(app.handle(req)).then((result) => {
      if (res.writableEnded) return;
      res.writeHead(result.status, {
        "Content-Type": result.type,
        "Cache-Control": result.status === 200 && result.type.startsWith("image/") ? "private, max-age=60" : "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(result.body);
    }).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end("error");
      }
    });
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 2_000;
  server.timeout = 5_000;
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

export function printSignedUrl(app, origin) {
  const url = app.sign("demo", 60, origin);
  process.stdout.write(`${url}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const secret = process.env.COVER_SIGNING_SECRET;
  const trusted = (process.env.TRUST_PROXY || "").split(",").map((item) => item.trim()).filter(Boolean);
  const app = createCoverApp({ secret, trustedProxies: trusted });
  const port = Number(process.env.PORT || 8787);
  if (process.argv[2] === "sign") {
    printSignedUrl(app, process.env.COVER_PUBLIC_ORIGIN);
  } else {
    listen(app, port).then((server) => {
      console.log(`cover service listening on 127.0.0.1:${server.address().port}`);
    });
  }
}
