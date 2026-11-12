import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createCoverApp, listen } from "./server.mjs";
import { optionalPoster } from "./rex-map.mjs";

const secret = "test-signing-secret-16";
const origin = "https://invalid.test";
let outbound = 0;
const started = 1_700_000_000_000;
let clock = started;
const app = createCoverApp({
  secret,
  now: () => clock,
  rateMax: 20,
  trustedProxies: ["127.0.0.1"],
  outbound: () => { outbound += 1; },
});

function png(body) {
  return body.length > 8 && body[0] === 0x89 && body[1] === 0x50 && body.toString("ascii", 12, 16) === "IHDR" && body.includes(Buffer.from("IEND"));
}

const signed = new URL(app.sign("demo", 60, origin));
const ok = await app.handle({ url: `${signed.pathname}${signed.search}` });
assert.equal(ok.status, 200);
assert.equal(ok.cache, "miss");
assert.ok(png(ok.body));

const again = await app.handle({ url: `${signed.pathname}?sig=${signed.searchParams.get("sig")}&exp=${signed.searchParams.get("exp")}` });
assert.equal(again.cache, "hit");
assert.equal(app.loads().get("demo"), 1);

const denied = await app.handle({ url: "/v1/demo.png" });
assert.equal(denied.status, 403);
assert.equal(png(denied.body), false);

clock = started + 121_000;
const replay = await app.handle({ url: `${signed.pathname}${signed.search}` });
assert.equal(replay.status, 403);
assert.equal(png(replay.body), false);
clock = started;

assert.equal((await app.handle({ url: "/v1/%64emo.png?exp=1&sig=abcd" })).status, 400);
assert.equal((await app.handle({ url: "/v1/demo.png?exp=1&exp=2&sig=abcd" })).status, 400);
assert.equal((await app.handle({ url: "/v1/demo.png?exp=1%30&sig=abcd" })).status, 400);
assert.equal((await app.handle({ url: `${signed.pathname}${signed.search}&url=https://example.invalid/a.jpg` })).status, 400);
assert.equal(outbound, 0);

const tampered = new URL(signed);
tampered.searchParams.set("sig", "a".repeat(43));
assert.equal((await app.handle({ url: `${tampered.pathname}${tampered.search}` })).status, 403);
assert.equal((await app.handle({ url: app.sign("other", 60, origin).replace(origin, "") })).status, 404);

const proxy = await app.handle({
  url: "/v1/demo.png",
  headers: { "x-forwarded-for": "203.0.113.9" },
}, "192.0.2.8");
assert.equal(proxy.status, 403);
const trusted = createCoverApp({ secret, now: () => clock, rateMax: 2, trustedProxies: ["127.0.0.1"] });
const trustedUrl = trusted.sign("demo", 30, origin).replace(origin, "");
assert.equal((await trusted.handle({ url: trustedUrl, headers: { "x-forwarded-for": "203.0.113.9" } }, "127.0.0.1")).status, 200);
assert.equal((await trusted.handle({ url: trustedUrl, headers: { "x-forwarded-for": "203.0.113.9" } }, "127.0.0.1")).status, 200);
assert.equal((await trusted.handle({ url: trustedUrl, headers: { "x-forwarded-for": "203.0.113.9" } }, "127.0.0.1")).status, 429);
assert.equal((await trusted.handle({ url: "/healthz", headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.2" } }, "127.0.0.1")).status, 200);

const many = createCoverApp({ secret, rateMaxKeys: 2, now: () => clock });
await many.handle({ url: "/healthz" }, "192.0.2.1");
await many.handle({ url: "/healthz" }, "192.0.2.2");
await many.handle({ url: "/healthz" }, "192.0.2.3");
assert.ok(many.rateSize() <= 2);

const child = spawn(process.execPath, ["cover-service/server.mjs"], {
  env: { ...process.env, COVER_SIGNING_SECRET: secret, PORT: "0", TRUST_PROXY: "" },
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
assert.equal(log.includes(secret), false);
const port = Number(log.match(/127\.0\.0\.1:(\d+)/)[1]);
const health = await fetch(`http://127.0.0.1:${port}/healthz`);
assert.equal(health.status, 200);
assert.equal(await health.text(), "ok");
const signer = spawn(process.execPath, ["cover-service/server.mjs", "sign"], {
  env: { ...process.env, COVER_SIGNING_SECRET: secret, COVER_PUBLIC_ORIGIN: origin },
  stdio: ["ignore", "pipe", "pipe"],
});
let signedOut = "";
signer.stdout.on("data", (chunk) => { signedOut += chunk; });
await once(signer, "exit");
const lines = signedOut.trim().split("\n");
assert.equal(lines.length, 1);
assert.equal(lines[0].startsWith(`${origin}/v1/demo.png?exp=`), true);
assert.equal(signedOut.includes(secret), false);
const image = await fetch(`http://127.0.0.1:${port}${lines[0].slice(origin.length)}`);
assert.equal(image.status, 200);
assert.equal(image.headers.get("content-type"), "image/png");
const liveBytes = Buffer.from(await image.arrayBuffer());
assert.equal(liveBytes[0], 0x89);
child.kill("SIGTERM");
await once(child, "exit");
await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`));

const scriptPort = "18787";
const start = spawn("sh", ["bin/cover-start.sh"], {
  cwd: "cover-service",
  env: { ...process.env, COVER_PUBLIC_ORIGIN: origin, PORT: scriptPort, COVER_SIGNING_SECRET: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let startErr = "";
start.stderr.on("data", (chunk) => { startErr += chunk; });
assert.equal((await once(start, "exit"))[0], 0);
let up = false;
for (let i = 0; i < 30; i += 1) {
  try {
    const probe = await fetch(`http://127.0.0.1:${scriptPort}/healthz`);
    if (probe.status === 200) { up = true; break; }
  } catch { /* wait */ }
  await new Promise((resolve) => setTimeout(resolve, 50));
}
assert.equal(up, true);
assert.equal(startErr.includes("base64"), false);
const healthScript = spawn("sh", ["bin/cover-health.sh"], {
  cwd: "cover-service",
  env: { ...process.env, PORT: scriptPort },
  stdio: ["ignore", "pipe", "pipe"],
});
let healthOut = "";
healthScript.stdout.on("data", (chunk) => { healthOut += chunk; });
assert.equal((await once(healthScript, "exit"))[0], 0);
assert.equal(healthOut.trim(), "ok");
const stop = spawn("sh", ["bin/cover-stop.sh"], { cwd: "cover-service", stdio: "ignore" });
assert.equal((await once(stop, "exit"))[0], 0);
await assert.rejects(fetch(`http://127.0.0.1:${scriptPort}/healthz`));

assert.deepEqual(optionalPoster(`http://127.0.0.1/v1/demo.png?exp=1&sig=abc`), {});
assert.equal(optionalPoster(`${origin}/v1/demo.png?exp=1&sig=abc`).posterPath.includes("sig=abc"), true);
assert.throws(() => createCoverApp({ secret: "short" }));
console.log("cover service tests: start, signed png, auth, query pollution, rate cap, cache, stop");
