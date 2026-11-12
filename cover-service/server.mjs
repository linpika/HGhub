// Required Notice: Copyright (c) 2026 HGhub contributors (https://github.com/Minireel/HGhub)
// License: PolyForm Noncommercial 1.0.0
// https://polyformproject.org/licenses/noncommercial/1.0.0
//
// 只处理游客接口已经返回、且主机在白名单内的封面。失败不换地址，也不记录封面查询串。
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { decodeCover, loadFormatMaterial } from "./decode.mjs";
import { verifyJpeg } from "./image.mjs";
import { mediaSourcePath } from "./paths.mjs";
import { coverUrl, fetchCoverBytes, resolveCover } from "./source.mjs";

const RATE_MAX_KEYS = 1024;

export function createCoverApp(options = {}) {
  const secret = options.secret;
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error("COVER_SIGNING_SECRET must be provided at runtime");
  }
  const material = options.material;
  if (!material) throw new Error("media format material missing");
  const now = options.now || (() => Date.now());
  const maxTtlSec = options.maxTtlSec || 300;
  const cacheTtlMs = options.cacheTtlMs || 600_000;
  const cacheMax = options.cacheMax || 32;
  const rateMax = options.rateMax || 30;
  const rateWindowMs = options.rateWindowMs || 60_000;
  const rateMaxKeys = options.rateMaxKeys || RATE_MAX_KEYS;
  const trustedProxies = new Set((options.trustedProxies || []).map(normalizeIp).filter(Boolean));
  const resolve = options.resolveCover || resolveCover;
  const fetchBytes = options.fetchCover || fetchCoverBytes;
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
    return createHmac("sha256", secret).update(`GET\n/v1/v/${id}.png\n${exp}`).digest();
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

  function store(id, body, t) {
    if (cache.size >= cacheMax && !cache.has(id)) cache.delete(cache.keys().next().value);
    cache.set(id, { body, type: "image/jpeg", exp: t + cacheTtlMs });
  }

  function clientIp(peer, headers) {
    const normalized = normalizeIp(peer);
    if (!normalized) return "";
    if (!trustedProxies.has(normalized)) return normalized;
    const forwarded = headers["x-forwarded-for"];
    if (typeof forwarded !== "string" || forwarded.includes(",")) return "";
    const client = normalizeIp(forwarded.trim());
    if (!client || trustedProxies.has(client)) return "";
    return client;
  }

  async function imageFor(id, t) {
    const hit = fromCache(id, t);
    if (hit) return { status: 200, type: hit.type, body: hit.body, cache: "hit" };
    let bytes;
    try {
      const url = await resolve(id);
      if (!coverUrl(url)) return text(502, "unavailable");
      bytes = await fetchBytes(url);
    } catch (error) {
      const status = error && (error.status === 403 || error.status === 400) ? error.status : 502;
      return text(status, status === 403 ? "forbidden" : "unavailable");
    }
    const plain = decodeCover(bytes, material);
    const checked = plain && verifyJpeg(plain);
    if (!checked) return text(502, "unavailable");
    loads.set(id, (loads.get(id) || 0) + 1);
    store(id, plain, t);
    return { status: 200, type: "image/jpeg", body: plain, cache: "miss", width: checked.width, height: checked.height };
  }

  async function handle(req, peerIp) {
    const t = now();
    const headers = req.headers || {};
    const raw = req.url || "";
    const cut = raw.indexOf("?");
    const rawPath = cut === -1 ? raw : raw.slice(0, cut);
    const rawQuery = cut === -1 ? "" : raw.slice(cut + 1);
    if (rawPath === "/healthz" && rawQuery === "") return text(200, "ok");
    const peer = peerIp || req.socket?.remoteAddress || "127.0.0.1";
    const ip = clientIp(peer, headers);
    if (!ip) return text(403, "forbidden");
    if (!allow(ip, t)) return text(429, "rate limited");
    if (rawPath.includes("%") || rawPath.includes("//") || rawPath.includes("..") || !rawPath.startsWith("/")) {
      return text(400, "bad path");
    }
    const match = /^\/v1\/v\/([1-9]\d{0,8})\.png$/.exec(rawPath);
    if (!match) return text(404, "not found");
    const id = match[1];
    const query = parseQuery(rawQuery);
    if (query.error) return text(query.error, query.error === 400 ? "bad query" : "forbidden");
    if (!authorized(id, query.exp, query.sig, t)) return text(403, "forbidden");
    return imageFor(id, t);
  }

  return {
    handle,
    loads: () => new Map(loads),
    rateSize: () => rates.size,
    sign(id, ttlSec = 60, origin) {
      if (!/^[1-9]\d{0,8}$/.test(id)) throw new Error("bad id");
      if (!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(origin || "")) {
        throw new Error("COVER_PUBLIC_ORIGIN must be an https origin");
      }
      const ttl = Math.min(Math.max(1, ttlSec), maxTtlSec);
      const exp = String(Math.floor(now() / 1000) + ttl);
      const sig = signature(id, exp).toString("base64url");
      return `${origin}/v1/v/${id}.png?exp=${exp}&sig=${sig}`;
    },
  };
}

function parseQuery(raw) {
  if (!raw) return { error: 403 };
  const found = new Map();
  for (const part of raw.split("&")) {
    if (!part) return { error: 403 };
    if (part.includes("%") || !/^(exp|sig)=[A-Za-z0-9_-]+$/.test(part)) return { error: 400 };
    const eq = part.indexOf("=");
    const key = part.slice(0, eq);
    if (found.has(key)) return { error: 400 };
    found.set(key, part.slice(eq + 1));
  }
  if (found.size !== 2) return { error: 403 };
  return { exp: found.get("exp"), sig: found.get("sig") };
}

function normalizeIp(value) {
  if (typeof value !== "string") return "";
  const text = value.trim().toLowerCase();
  if (!text || text.length > 64 || /[^0-9a-f:.]/.test(text)) return "";
  return text.startsWith("::ffff:") ? text.slice(7) : text;
}

export function readSecret() {
  if (process.env.COVER_SIGNING_SECRET) return process.env.COVER_SIGNING_SECRET;
  if (!process.env.COVER_SECRET_FILE) return "";
  return readFileSync(process.env.COVER_SECRET_FILE, "utf8").trim();
}

export function listen(app, port = 0, host = "127.0.0.1") {
  const server = createServer((req, res) => {
    req.setTimeout(8_000, () => req.destroy());
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
  server.requestTimeout = 8_000;
  server.headersTimeout = 2_000;
  server.timeout = 8_000;
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const secret = readSecret();
  const material = loadFormatMaterial(mediaSourcePath());
  const trusted = (process.env.TRUST_PROXY || "").split(",").map((item) => item.trim()).filter(Boolean);
  const bind = process.env.BIND || "127.0.0.1";
  if ((bind === "0.0.0.0" || bind === "::") && trusted.length !== 1) {
    console.error("TRUST_PROXY must be one exact address when BIND is open");
    process.exit(1);
  }
  const app = createCoverApp({ secret, material, trustedProxies: trusted });
  if (process.argv[2] === "sign") {
    const id = process.argv[3] || "";
    if (!/^[1-9]\d{0,8}$/.test(id)) {
      console.error("video id is required");
      process.exit(1);
    }
    process.stdout.write(`${app.sign(id, 240, process.env.COVER_PUBLIC_ORIGIN)}\n`);
  } else {
    const port = Number(process.env.PORT || 8787);
    listen(app, port, bind).then((server) => {
      console.log(`cover service listening on ${bind}:${server.address().port}`);
    });
  }
}
