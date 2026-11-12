import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createCoverApp, listen } from "./server.mjs";
import { loadFormatMaterial } from "./decode.mjs";
import { sampleJpeg, verifyJpeg } from "./image.mjs";
import { coverUrl, fetchCoverBytes, resolveCover } from "./source.mjs";

const secret = "test-signing-secret-16";
const origin = "https://img-2c812d1bf79fee03e88d.linpika.com";
const mediaPath = new URL("../src-tauri/src/media.rs", import.meta.url);
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
  trustedProxies: ["127.0.0.1"],
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

const ok = await app.handle({ url: "/v1/v/12.png" });
assert.equal(ok.status, 200);
assert.equal(ok.cache, "miss");
assert.equal(ok.type, "image/jpeg");
assert.equal(verifyJpeg(ok.body).width, 2);
assert.equal(verifyJpeg(ok.body).height, 3);
const again = await app.handle({ url: "/v1/v/12.png" });
assert.equal(again.cache, "hit");
assert.equal(calls.fetch, 1);
assert.equal(calls.resolve, 1);

const signed = new URL(app.sign("12", 60, origin));
const signedHit = await app.handle({ url: `${signed.pathname}?sig=${signed.searchParams.get("sig")}&exp=${signed.searchParams.get("exp")}` });
assert.equal(signedHit.cache, "hit");
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
assert.equal((await app.handle({ url: "/v1/v/13.png" })).status, 502);
assert.equal(calls.fetch, 1);
assert.equal((await app.handle({ url: "/v1/v/14.png" })).status, 403);
assert.equal((await app.handle({ url: "/v1/v/14.png" })).status, 403);
assert.equal(calls.fetch, 1);
assert.equal((await app.handle({ url: "/v1/demo.png" })).status, 404);

assert.equal(coverUrl("http://pic.drleao.cn/a.jpg"), null);
assert.equal(coverUrl("https://user:pass@pic.drleao.cn/a.jpg"), null);
assert.equal(coverUrl("https://pic.drleao.cn:8443/a.jpg"), null);
assert.equal(coverUrl("https://evil.example/a.jpg"), null);
assert.equal(coverUrl("https://pic.drleao.cn/a.jpg").hostname, "pic.drleao.cn");

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
await many.handle({ url: "/healthz" }, "192.0.2.1");
await many.handle({ url: "/healthz" }, "192.0.2.2");
await many.handle({ url: "/healthz" }, "192.0.2.3");
assert.ok(many.rateSize() <= 2);

const child = spawn(process.execPath, ["cover-service/server.mjs"], {
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

const widget = readFileSync(new URL("../rex/hghub.widget.js", import.meta.url), "utf8");
if (widget.includes(materialText)) throw new Error("widget contains format material");
console.log("cover service tests: offline jpeg, allowlist, denied, auth before cache, stop");
