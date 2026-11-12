import assert from "node:assert/strict";
import { createCoverApp, listen } from "./server.mjs";
import { optionalPoster } from "./rex-map.mjs";

const secret = "test-signing-secret-16";
let outbound = 0;
const app = createCoverApp({
  secret,
  now: () => 1_700_000_000_000,
  rateMax: 20,
  outbound: () => { outbound += 1; },
});

function png(body) {
  return body.length > 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47;
}

const signed = new URL(app.sign("demo", 60));
const ok = await app.handle({ url: signed.pathname + signed.search });
assert.equal(ok.status, 200);
assert.equal(ok.type, "image/png");
assert.equal(ok.cache, "miss");
assert.ok(png(ok.body));
assert.ok(ok.body.includes(Buffer.from("IHDR")));
assert.ok(ok.body.includes(Buffer.from("IEND")));

const again = await app.handle({ url: signed.pathname + signed.search });
assert.equal(again.cache, "hit");
assert.equal(app.loads().get("demo"), 1);
assert.ok(again.body.equals(ok.body));

const denied = await app.handle({ url: "/v1/demo.png" });
assert.equal(denied.status, 403);
assert.equal(denied.type.startsWith("image/"), false);
assert.equal(png(denied.body), false);

const expired = new URL(app.sign("demo", 60));
expired.searchParams.set("exp", "100");
const old = await app.handle({ url: expired.pathname + expired.search });
assert.equal(old.status, 403);
assert.equal(png(old.body), false);

const tampered = new URL(signed);
tampered.searchParams.set("sig", `${tampered.searchParams.get("sig").slice(0, -2)}aa`);
const bad = await app.handle({ url: tampered.pathname + tampered.search });
assert.equal(bad.status, 403);

const other = new URL(app.sign("other", 60));
const unapproved = await app.handle({ url: other.pathname + other.search });
assert.equal(unapproved.status, 404);
assert.equal(png(unapproved.body), false);
assert.equal(outbound, 0);

const extra = new URL(signed);
extra.searchParams.set("url", "https://example.invalid/secret.jpg");
const forwarded = await app.handle({ url: extra.pathname + extra.search });
assert.equal(forwarded.status, 400);
assert.equal(outbound, 0);

const limited = createCoverApp({ secret, rateMax: 1, now: () => 1_700_000_000_000 });
const once = new URL(limited.sign("demo", 30));
assert.equal((await limited.handle({ url: once.pathname + once.search }, "203.0.113.8")).status, 200);
const blocked = await limited.handle({ url: "/v1/demo.png" }, "203.0.113.8");
assert.equal(blocked.status, 429);
assert.equal(png(blocked.body), false);

const serverApp = createCoverApp({ secret, now: () => 1_700_000_000_000, rateMax: 10 });
const serverUrl = new URL(serverApp.sign("demo", 60));
const server = await listen(serverApp, 0);
const port = server.address().port;
const live = await fetch(`http://127.0.0.1:${port}${serverUrl.pathname}${serverUrl.search}`);
assert.equal(live.status, 200);
assert.equal(live.headers.get("content-type"), "image/png");
const bytes = Buffer.from(await live.arrayBuffer());
assert.ok(bytes.equals(ok.body));
server.close();

assert.deepEqual(optionalPoster("http://cover.example/v1/demo.png?exp=1&sig=abc"), {});
assert.deepEqual(optionalPoster("https://cover.example/v1/demo.png"), {});
const mapped = optionalPoster("https://cover.example/v1/demo.png?exp=1700000060&sig=abc");
assert.equal(mapped.posterPath.startsWith("https://cover.example/v1/demo.png?"), true);
assert.equal(mapped.coverUrl, undefined);

assert.throws(() => createCoverApp({ secret: "short" }), /COVER_SIGNING_SECRET/);
console.log("cover service tests: signed png, denied, expired, tampered, cache, no outbound, rate limit");
