import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCoverApp, listen } from "./server.mjs";
import { loadFormatMaterial } from "./decode.mjs";
import { sampleJpeg, verifyJpeg } from "./image.mjs";
import { mediaSourcePath, widgetSourcePath } from "./paths.mjs";
import { coverUrl, fetchCoverBytes, isPublicAddress, resolveCover } from "./source.mjs";

const secret = "test-signing-secret-16";
const origin = "https://img-2c812d1bf79fee03e88d.linpika.com";
const mediaPath = mediaSourcePath();
const material = loadFormatMaterial(mediaPath);
const started = 1_700_000_000_000;
let clock = started;
const plain = sampleJpeg(2, 3);
const cipher = createCipheriv("aes-128-cbc", material.key, material.iv);
const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
const checked = verifyJpeg(plain);
assert.equal(checked.format, "jpeg");
assert.equal(checked.width, 2);
assert.equal(checked.height, 3);

const calls = { resolve: 0, fetch: 0 };
const app = createCoverApp({
  secret,
  material,
  now: () => clock,
  rateMax: 20,
  async resolveCover(id) {
    calls.resolve += 1;
    if (id === "13") return "https://evil.example/a.jpg";
    if (id === "14") { const error = new Error("cover denied"); error.status = 403; throw error; }
    return "https://pic.drleao.cn/offline.jpg?auth_key=offline";
  },
  async fetchCover(url) {
    calls.fetch += 1;
    const parsed = new URL(url);
    if (parsed.hostname !== "pic.drleao.cn") throw new Error("fetch left the allowlist");
    return encrypted;
  },
});

const denied = await app.handle({ url: "/v1/v/12.png" });
assert.equal(denied.status, 403);
assert.equal(verifyJpeg(denied.body), null);
assert.equal((await app.handle({ url: "/v1/v/12.png?" })).status, 403);
assert.equal(calls.fetch, 0);

const signed = new URL(app.sign("12", 60, origin));
const ok = await app.handle({ url: `${signed.pathname}${signed.search}` });
assert.equal(ok.status, 200);
assert.equal(ok.cache, "miss");
assert.equal(ok.type, "image/jpeg");
assert.equal(verifyJpeg(ok.body).width, 2);
assert.equal(verifyJpeg(ok.body).height, 3);
const again = await app.handle({ url: `${signed.pathname}?sig=${signed.searchParams.get("sig")}&exp=${signed.searchParams.get("exp")}` });
assert.equal(again.cache, "hit");
assert.equal(calls.fetch, 1);
assert.equal(calls.resolve, 1);
assert.equal((await app.handle({ url: "/v1/v/12.png" })).status, 403);
assert.equal(calls.fetch, 1);

const forged = await app.handle({ url: "/v1/v/12.png?exp=1700000060&sig=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
assert.equal(forged.status, 403);
assert.equal(verifyJpeg(forged.body), null);
assert.equal(calls.fetch, 1);

clock = started + 121_000;
assert.equal((await app.handle({ url: `${signed.pathname}${signed.search}` })).status, 403);
clock = started;
assert.equal((await app.handle({ url: "/v1/%76/12.png" })).status, 400);
assert.equal((await app.handle({ url: "/v1/v/12.png?exp=1&exp=2&sig=abcd" })).status, 400);
assert.equal((await app.handle({ url: "/v1/v/12.png?url=https://evil.example/a.jpg" })).status, 400);
assert.equal(calls.fetch, 1);
function signedPath(id) {
  const url = new URL(app.sign(id, 60, origin));
  return `${url.pathname}${url.search}`;
}
assert.equal((await app.handle({ url: signedPath("13") })).status, 502);
assert.equal(calls.fetch, 1);
assert.equal((await app.handle({ url: signedPath("14") })).status, 403);
assert.equal((await app.handle({ url: signedPath("14") })).status, 403);
assert.equal(calls.fetch, 1);
assert.equal((await app.handle({ url: "/v1/demo.png" })).status, 404);

assert.equal(coverUrl("http://pic.drleao.cn/a.jpg"), null);
assert.equal(coverUrl("https://user:pass@pic.drleao.cn/a.jpg"), null);
assert.equal(coverUrl("https://pic.drleao.cn:8443/a.jpg"), null);
assert.equal(coverUrl("https://evil.example/a.jpg"), null);
assert.equal(isPublicAddress("203.0.113.10"), true);
assert.equal(isPublicAddress("10.0.0.8"), false);
assert.equal(isPublicAddress("127.0.0.1"), false);
assert.equal(isPublicAddress("169.254.1.1"), false);
assert.equal(isPublicAddress("192.168.1.1"), false);
assert.equal(isPublicAddress("::ffff:10.0.0.1"), false);
assert.equal(isPublicAddress("fe80::1"), false);
assert.equal(isPublicAddress("fd00::1"), false);
let privateFetched = 0;
await assert.rejects(() => fetchCoverBytes("https://pic.drleao.cn/a.jpg", async () => {
  privateFetched += 1;
  throw new Error("fetched private address");
}, async () => ["10.0.0.8"]), /cover address rejected/);
assert.equal(privateFetched, 0);
let pinned = "";
let hops = 0;
await assert.rejects(() => fetchCoverBytes("https://pic.drleao.cn/start.jpg", async (url) => {
  hops += 1;
  if (hops > 1) throw new Error("followed a private redirect");
  return { status: 302, headers: { get: () => "https://pic.drleao.cn/next.jpg" }, arrayBuffer: async () => Buffer.alloc(0), pinned: url };
}, async () => (hops === 0 ? ["203.0.113.10"] : ["169.254.1.1"])), /cover address rejected/);
const allowed = await fetchCoverBytes("https://pic.drleao.cn/a.jpg", async (_url, options) => {
  pinned = options.pinned;
  return { status: 200, headers: { get: () => null }, arrayBuffer: async () => Buffer.from("abc") };
}, async () => ["203.0.113.10", "203.0.113.11"]);
assert.equal(pinned, "203.0.113.10");
assert.equal(allowed.toString(), "abc");

const trusted = createCoverApp({
  secret,
  material,
  now: () => clock,
  rateMax: 1,
  trustedProxies: ["127.0.0.1"],
  resolveCover: async () => "https://pic.drleao.cn/offline.jpg",
  fetchCover: async () => encrypted,
});
const trustedUrl = trusted.sign("12", 60, origin).replace(origin, "");
assert.equal((await trusted.handle({ url: trustedUrl, headers: {} }, "127.0.0.1")).status, 403);
assert.equal((await trusted.handle({ url: trustedUrl, headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.2" } }, "127.0.0.1")).status, 403);
assert.equal((await trusted.handle({ url: trustedUrl, headers: { "x-forwarded-for": "203.0.113.9" } }, "127.0.0.1")).status, 200);
assert.equal((await trusted.handle({ url: trustedUrl, headers: { "x-forwarded-for": "203.0.113.9" } }, "127.0.0.1")).status, 429);
assert.equal((await trusted.handle({ url: trustedUrl, headers: { "x-forwarded-for": "203.0.113.10" } }, "127.0.0.1")).status, 200);

await assert.rejects(() => fetchCoverBytes("https://pic.drleao.cn/start.jpg", async (url) => {
  if (url.endsWith("/start.jpg")) {
    return { status: 302, headers: { get: () => "https://evil.example/a.jpg" }, arrayBuffer: async () => Buffer.alloc(0) };
  }
  throw new Error("followed a rejected redirect");
}), /cover redirect rejected/);

const apiCalls = [];
await assert.rejects(() => resolveCover("12", async (url, options) => {
  apiCalls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
  return { status: 200, json: async () => ({ status: 1, data: { cover: "https://evil.example/a.jpg" } }) };
}), /cover source rejected/);
assert.equal(apiCalls[0].body.path, "/api/videos/12");
assert.equal(apiCalls[0].headers.Authorization, undefined);
assert.equal(apiCalls[0].url, "https://huangguoai.com/api/edge/request");

const many = createCoverApp({ secret, material, rateMaxKeys: 2, now: () => clock, resolveCover: async () => { throw new Error("unused"); } });
await many.handle({ url: "/v1/v/1.png" }, "192.0.2.1");
await many.handle({ url: "/v1/v/1.png" }, "192.0.2.2");
await many.handle({ url: "/v1/v/1.png" }, "192.0.2.3");
assert.equal(many.rateSize(), 2);

const serverPath = fileURLToPath(new URL("./server.mjs", import.meta.url));
const child = spawn(process.execPath, [serverPath], {
  cwd: dirname(serverPath),
  env: { ...process.env, COVER_SIGNING_SECRET: secret, PORT: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (chunk) => { log += chunk; });
child.stderr.on("data", (chunk) => { log += chunk; });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server did not listen")), 3000);
  child.stdout.on("data", () => {
    if (log.includes("listening on 127.0.0.1:")) {
      clearTimeout(timer);
      resolve();
    }
  });
});
const source = readFileSync(mediaPath, "utf8");
const materialText = /const IMG_KEY: &\[u8\] = b"([^"]+)";/.exec(source)[1];
if (log.includes(materialText) || log.includes(secret)) throw new Error("service log exposed secret material");
const port = Number(log.match(/127\.0\.0\.1:(\d+)/)[1]);
assert.equal(await (await fetch(`http://127.0.0.1:${port}/healthz`)).text(), "ok");
child.kill("SIGTERM");
await once(child, "exit");
await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`));

const widget = readFileSync(widgetSourcePath(), "utf8");
if (widget.includes(materialText)) throw new Error("widget contains format material");
const missingId = spawnSync("sh", [fileURLToPath(new URL("./bin/cover-sign.sh", import.meta.url))], {
  cwd: dirname(serverPath),
  env: { ...process.env, COVER_SIGNING_SECRET: secret, COVER_PUBLIC_ORIGIN: origin },
  encoding: "utf8",
});
assert.notEqual(missingId.status, 0);
assert.equal(missingId.stdout, "");
const signedLine = spawnSync("sh", [fileURLToPath(new URL("./bin/cover-sign.sh", import.meta.url)), "12"], {
  cwd: dirname(serverPath),
  env: { ...process.env, COVER_SIGNING_SECRET: secret, COVER_PUBLIC_ORIGIN: origin },
  encoding: "utf8",
});
assert.equal(signedLine.status, 0);
assert.equal(signedLine.stdout.trim().split("\n").length, 1);
assert.equal(signedLine.stdout.includes("/v1/v/12.png?"), true);
assert.equal(signedLine.stdout.includes(secret), false);
const up = spawnSync("sh", [fileURLToPath(new URL("./deploy/cover-up.sh", import.meta.url))], {
  encoding: "utf8",
});
assert.notEqual(up.status, 0);
assert.match(up.stderr, /COVER_NETWORK/);
const widgetRun = spawnSync(process.execPath, [fileURLToPath(new URL("test-widget.mjs", widgetSourcePath()))], {
  stdio: "inherit",
});
if (widgetRun.status !== 0) process.exit(widgetRun.status ?? 1);
console.log("cover service tests: signature required, allowlist, private address, auth before cache, stop");
