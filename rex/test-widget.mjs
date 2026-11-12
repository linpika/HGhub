// 合成 fixture。不访问 huangguoai.com，也不把结果当成播放成功。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const widgetPath = resolve(dirname(fileURLToPath(import.meta.url)), "hghub.widget.js");
const source = readFileSync(widgetPath, "utf8");
const imageKey = "f5d965df75336270";
const cases = [];

function test(name, fn) {
  cases.push(Promise.resolve().then(fn).then(
    () => ({ name, ok: true }),
    (error) => ({ name, ok: false, error }),
  ));
}

function loadWidget(http) {
  const sandbox = { Widget: { http }, console };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: widgetPath });
  return sandbox;
}

function jsonResponse(data, statusCode = 200) {
  return { statusCode, data };
}

function envelope(data, status = 1, msg = "") {
  return { status, data, msg };
}

const feedData = {
  items: [
    {
      id: 501,
      title: "样片甲",
      description: "合成描述",
      cover: "https://cdn.example/cipher-cover",
      tags: ["样例"],
      score: 8.5,
      episode_count: 2,
      created_at: "2026-01-02",
    },
  ],
  pagination: { page: 1, pages: 3, size: 20, total: 41 },
};

const detailData = {
  id: 501,
  title: "样片甲",
  description: "合成详情",
  cover: "https://cdn.example/cipher-cover",
  tags: ["样例"],
  score: 8.5,
  episodes: [
    { ep_num: 1, title: "第一集", duration: 60, status: 1 },
    { ep_num: 2, title: "第二集", duration: 70, status: 1 },
  ],
  created_at: "2026-01-02",
};

function scriptedHttp(script) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async post(url, body, options) {
      calls.push({ url, body, headers: options && options.headers });
      if (index >= script.length) throw new Error(`意外的第 ${index + 1} 次请求 ${body.method} ${body.path}`);
      const step = script[index];
      index += 1;
      if (step.expect) step.expect(body);
      if (step.impl) return step.impl();
      return step.response;
    },
  };
}

test("源码不嵌入封面密钥、令牌或第二线路", () => {
  assert.equal(source.includes(imageKey), false);
  assert.equal(source.includes("Authorization"), false);
  assert.equal(source.includes("huangguoai.ai"), false);
  assert.equal(source.includes("auth_key"), false);
  assert.match(source, /Required Notice: Copyright \(c\) 2026 HGhub contributors/);
});

function executableMetadata(code) {
  const rewritten = code.replace(/\b(?:export\s+)?(?:const|let|var)\s+WidgetMetadata\b/g, "WidgetMetadata");
  const sandbox = { WidgetMetadata: null };
  const func = new Function(
    "sandbox",
    "Widget",
    `let WidgetMetadata;\n${rewritten}\nsandbox.WidgetMetadata = WidgetMetadata;`,
  );
  func(sandbox, { http: { post() { throw new Error("导入检查不应发请求"); } } });
  return sandbox.WidgetMetadata;
}

test("导入声明与官方公开模块一致，且只有一份完整元数据", () => {
  assert.match(source, /^WidgetMetadata = \{/);
  assert.equal(source.split("WidgetMetadata").length - 1, 1);
  assert.equal(source.includes("/* WidgetMetadata"), false);
  const metadata = executableMetadata(source);
  assert.equal(metadata.id, "hghub.library");
  assert.equal(metadata.version, "0.2.0");
  assert.equal(metadata.requiredVersion, "0.0.1");
  assert.deepEqual(metadata.modules.map((item) => item.id), [
    "feed", "ai-duanju", "ai-manju", "ai-huanlian", "ai-mogai",
    "rank-hot", "rank-recommend", "rank-potential", "loadResource",
  ]);
  assert.equal(metadata.modules[1].params[0].type, "constant");
  assert.equal(metadata.modules[1].params[0].value, "ai-duanju");
  assert.equal(metadata.modules[5].params[0].value, "hot");
  assert.equal(metadata.modules[8].type, "stream");
  const sandbox = loadWidget({ async post() { throw new Error("不应发请求"); } });
  for (const name of ["loadFeed", "loadCategory", "loadRank", "loadDetail", "loadResource"]) {
    assert.equal(typeof sandbox[name], "function");
  }
});

test("空对象的 base64 与客户端 STANDARD 编码一致", () => {
  const sandbox = loadWidget({ async post() { throw new Error("不应发请求"); } });
  assert.equal(sandbox.HGhubWidget.base64Ascii("{}"), "e30=");
  assert.equal(Buffer.from("e30=", "base64").toString(), "{}");
});

test("列表到详情再到播放地址，且不把封面密文当成封面", async () => {
  const playUrl = "https://cdn.example/videos/sample.m3u8";
  const http = scriptedHttp([
    {
      expect(body) {
        assert.equal(body.method, "GET");
        assert.equal(body.path, "/api/videos?page=1&size=20");
        assert.equal(body.body, "");
        assert.equal(body.content_type, "");
      },
      response: jsonResponse(envelope(feedData)),
    },
    {
      expect(body) {
        assert.equal(body.method, "GET");
        assert.equal(body.path, "/api/videos/501");
      },
      response: jsonResponse(envelope(detailData)),
    },
    {
      expect(body) {
        assert.equal(body.method, "POST");
        assert.equal(body.path, "/api/videos/501/episodes/2/playback");
        assert.equal(body.body, "e30=");
        assert.equal(body.content_type, "application/json");
      },
      response: jsonResponse(envelope({
        id: 501,
        ep_num: 2,
        video_url: "",
        streams: { main: playUrl, hevc: "https://cdn.example/hevc.m3u8", preview: "https://cdn.example/preview.mp4" },
      })),
    },
  ]);
  const sandbox = loadWidget(http);
  const list = await sandbox.loadFeed({ page: "1" });
  assert.equal(list.length, 1);
  assert.equal(list[0].link, "hghub:video:501");
  assert.equal(list[0].type, "detail");
  assert.equal(list[0].videoUrl, undefined);
  assert.equal(list[0].coverUrl, undefined);
  assert.equal(list[0].mediaType, "tv");

  const detail = await sandbox.loadDetail(list[0].link);
  assert.equal(detail.episodeItems.length, 2);
  assert.equal(detail.episodeItems[1].link, "hghub:video:501:2");
  assert.equal(detail.episodeItems[1].videoUrl, undefined);
  assert.equal(detail.coverUrl, undefined);

  const resources = await sandbox.loadResource({ link: detail.episodeItems[1].link, episode: 2 });
  assert.equal(resources.length, 1);
  assert.equal(resources[0].url, playUrl);
  assert.equal(resources[0].description, "HLS");
  assert.equal(resources[0].customHeaders.Referer, "https://huangguoai.com/");
  assert.equal(resources[0].headers.Referer, "https://huangguoai.com/");
  assert.equal(http.calls.length, 3);
  for (const call of http.calls) {
    assert.equal(call.url, "https://huangguoai.com/api/edge/request");
    assert.equal(call.headers.Authorization, undefined);
    assert.equal(call.headers.Cookie, undefined);
  }
});

test("新播放接口没有主地址时，同一线路回退到旧播放接口", async () => {
  const http = scriptedHttp([
    { response: jsonResponse(envelope({ streams: { main: "", hevc: "https://cdn.example/only-hevc.m3u8" }, video_url: "" })) },
    { response: jsonResponse(envelope({ video_url: "https://cdn.example/legacy.mp4", streams: {} })) },
  ]);
  const sandbox = loadWidget(http);
  const resources = await sandbox.loadResource({ link: "hghub:video:501:1" });
  assert.equal(resources[0].url, "https://cdn.example/legacy.mp4");
  assert.equal(resources[0].description, undefined);
  assert.equal(http.calls[0].body.path, "/api/videos/501/episodes/1/playback");
  assert.equal(http.calls[1].body.path, "/api/videos/501/play?ep=1&page_texts=0");
  assert.equal(http.calls.length, 2);
});

test("两个播放接口都没有可用地址时失败，而不是返回空地址", async () => {
  const http = scriptedHttp([
    { response: jsonResponse(envelope({ streams: { main: "" }, video_url: "" })) },
    { response: jsonResponse(envelope({ video_url: "http://cdn.example/insecure.mp4" })) },
  ]);
  const sandbox = loadWidget(http);
  await assert.rejects(
    () => sandbox.loadResource({ link: "hghub:video:501:1" }),
    /播放接口没有返回可用地址/,
  );
});

test("播放接口拒绝访问时停止，不改走旧接口或别的线路", async () => {
  const http = scriptedHttp([
    { response: jsonResponse({ status: 0, msg: "no" }, 403) },
    { response: jsonResponse(envelope({ video_url: "https://cdn.example/should-not-be-used.mp4" })) },
  ]);
  const sandbox = loadWidget(http);
  await assert.rejects(
    () => sandbox.loadResource({ link: "hghub:video:501:1" }),
    /访问被拒绝（HTTP 403）/,
  );
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].url, "https://huangguoai.com/api/edge/request");
});

test("空列表是空数组，缺少 items 或业务失败不能当成空列表", async () => {
  const emptyHttp = scriptedHttp([
    { response: jsonResponse(envelope({ items: [], pagination: { page: 2, pages: 2, size: 20, total: 20 } })) },
  ]);
  const emptyWidget = loadWidget(emptyHttp);
  const empty = await emptyWidget.loadFeed({ page: 2 });
  assert.deepEqual(empty, []);

  const missingHttp = scriptedHttp([{ response: jsonResponse(envelope({ pagination: { page: 1 } })) }]);
  await assert.rejects(() => loadWidget(missingHttp).loadFeed({}), /列表响应缺少 items 数组/);

  const failedHttp = scriptedHttp([{ response: jsonResponse(envelope(null, 0, "请先登录")) }]);
  await assert.rejects(() => loadWidget(failedHttp).loadFeed({}), /请先登录/);
});

test("不兼容响应、重定向、缺选集和凭据都失败", async () => {
  await assert.rejects(
    () => loadWidget(scriptedHttp([{ response: { statusCode: 200, data: "<html>blocked</html>" } }])).loadFeed({}),
    /接口响应不是 JSON/,
  );
  await assert.rejects(
    () => loadWidget(scriptedHttp([{ response: { statusCode: 302, data: "" } }])).loadFeed({}),
    /业务接口重定向已拒绝/,
  );
  await assert.rejects(
    () => loadWidget(scriptedHttp([])).loadDetail({ link: "hghub:video:501" }),
    /详情参数必须是列表条目的 link 字符串/,
  );
  await assert.rejects(
    () => loadWidget(scriptedHttp([])).loadResource({ link: "hghub:video:501" }),
    /缺少选集编号/,
  );
  await assert.rejects(
    () => loadWidget(scriptedHttp([])).loadFeed({ token: "secret-token" }),
    /模块不接受登录凭据/,
  );
  const http = scriptedHttp([]);
  await assert.rejects(() => loadWidget(http).loadFeed({ genreId: "样例" }), /没有按标签或人物筛选的接口/);
  assert.equal(http.calls.length, 0);
});

test("分类、排行榜和最新都能进同一条详情与播放链路，且不把密文封面当成海报", async () => {
  const playUrl = "https://cdn.example/videos/sample.m3u8";
  const card = {
    ...feedData.items[0],
    cover: "https://pic.example/cipher.jpg?auth=1",
    description: "合成简介",
    tags: ["标签甲", "标签乙"],
  };
  const rankCard = {
    video_id: 501,
    title: "样片甲",
    cover: "https://pic.example/cipher.jpg",
    tags: ["标签甲"],
    score: 8.5,
    episode_count: 2,
    cate_name: "短剧",
    rank: 1,
  };
  async function playThrough(listCall) {
    const http = scriptedHttp([
      listCall,
      { response: jsonResponse(envelope(detailData)) },
      { response: jsonResponse(envelope({ streams: { main: playUrl }, video_url: "" })) },
    ]);
    const sandbox = loadWidget(http);
    const list = await listCall.run(sandbox);
    assert.equal(list[0].link, "hghub:video:501");
    assert.equal(list[0].description, listCall.expectDescription);
    assert.equal(list[0].genreTitle, listCall.expectGenre);
    assert.equal(list[0].coverUrl, undefined);
    assert.equal(list[0].posterPath, undefined);
    assert.equal(list[0].backdropPath, undefined);
    const detail = await sandbox.loadDetail(list[0].link);
    assert.equal(detail.episodeItems.length, 2);
    assert.equal(detail.description, "合成详情");
    const resources = await sandbox.loadResource({ link: detail.episodeItems[0].link });
    assert.equal(resources[0].url, playUrl);
    assert.equal(http.calls[0].body.path, listCall.path);
  }
  await playThrough({
    path: "/api/videos?page=1&size=20",
    expectDescription: "合成简介",
    expectGenre: "标签甲 / 标签乙",
    response: jsonResponse(envelope({ items: [card], pagination: feedData.pagination })),
    run: (sandbox) => sandbox.loadFeed({ page: 1 }),
  });
  await playThrough({
    path: "/api/videos/category/ai-duanju?page=2&size=20",
    expectDescription: "合成简介",
    expectGenre: "标签甲 / 标签乙",
    response: jsonResponse(envelope({ items: [card], pagination: { page: 2, pages: 2, size: 20, total: 21 } })),
    run: (sandbox) => sandbox.loadCategory({ cate: "ai-duanju", page: "2" }),
  });
  await playThrough({
    path: "/api/ranks/hot",
    expectDescription: undefined,
    expectGenre: "标签甲",
    response: jsonResponse(envelope({ type: "hot", items: [rankCard] })),
    run: (sandbox) => sandbox.loadRank({ kind: "hot" }),
  });
  const rankHttp = scriptedHttp([]);
  const secondPage = await loadWidget(rankHttp).loadRank({ kind: "recommend", page: 2 });
  assert.equal(Array.isArray(secondPage), true);
  assert.equal(secondPage.length, 0);
  assert.equal(rankHttp.calls.length, 0);
  await assert.rejects(() => loadWidget(scriptedHttp([])).loadCategory({ cate: "other" }), /分类无效/);
  await assert.rejects(() => loadWidget(scriptedHttp([])).loadRank({ kind: "topic" }), /榜单无效/);
});

test("详情没有选集时不编造选集或播放地址", async () => {
  const http = scriptedHttp([
    { response: jsonResponse(envelope({ ...detailData, episodes: [] })) },
  ]);
  const sandbox = loadWidget(http);
  const detail = await sandbox.loadDetail("hghub:video:501");
  assert.deepEqual(detail.episodeItems, []);
  assert.equal(detail.videoUrl, undefined);
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].body.path, "/api/videos/501");
});

const results = await Promise.all(cases);
const failed = results.filter((item) => !item.ok);
for (const item of results) {
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.ok) console.error(item.error);
}
console.log(`rex widget fixture tests: ${results.length - failed.length} passed, ${failed.length} failed`);
console.log("这些测试使用合成响应，没有访问真实站点，也没有播放视频。");
if (failed.length) process.exit(1);
