// 最小公开链路探针：只打固定线路的游客信封，不下载媒体，不打印标题、查询串或地址全文。
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const widgetPath = resolve(dirname(fileURLToPath(import.meta.url)), "hghub.widget.js");
const source = readFileSync(widgetPath, "utf8");
const calls = [];

function redact(text) {
  return String(text)
    .replace(/https?:\/\/[^\s'")]+/g, (value) => {
      try {
        return `${new URL(value).origin}/…`;
      } catch {
        return "[url]";
      }
    })
    .slice(0, 180);
}

async function playlistPrefix(url, headers) {
  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  const redirected = response.status >= 300 && response.status < 400;
  if (response.status !== 200) {
    await response.body?.cancel();
    return { status: response.status, extm3u: false, bytes: 0, redirected, segmentRequests: 0 };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  const cap = 4096;
  while (bytes < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    const slice = value.subarray(0, cap - bytes);
    chunks.push(slice);
    bytes += slice.length;
  }
  await reader.cancel();
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  return {
    status: response.status,
    extm3u: text.startsWith("#EXTM3U"),
    bytes,
    redirected,
    segmentRequests: 0,
  };
}

function urlFacts(url) {
  try {
    const parsed = new URL(url);
    return {
      https: parsed.protocol === "https:",
      host: parsed.host,
      m3u8: /\.m3u8$/i.test(parsed.pathname),
      hasQuery: parsed.search.length > 0,
    };
  } catch {
    return { https: false, host: "", m3u8: false, hasQuery: false };
  }
}

const sandbox = {
  console,
  Widget: {
    http: {
      async post(url, body, options) {
        const headers = { ...(options && options.headers), "Content-Type": "application/json" };
        calls.push({
          url,
          method: body && body.method,
          path: body && body.path,
          authorization: Boolean(headers.Authorization || headers.authorization),
        });
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          redirect: "manual",
          signal: AbortSignal.timeout(20000),
        });
        const text = await response.text();
        let data = text;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text.slice(0, 80);
          }
        }
        return { statusCode: response.status, data };
      },
    },
  },
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: widgetPath });

const report = {
  kind: "public-guest-probe",
  origin: "https://huangguoai.com",
  mediaDownloaded: false,
  rexDevice: false,
  calls: [],
};

try {
  const list = await sandbox.loadFeed({ page: 1 });
  report.list = {
    count: list.length,
    id: list[0] && /^[1-9]\d*$/.test(String(list[0].id)) ? String(list[0].id) : "",
    linkShape: list[0] ? /^hghub:video:\d+$/.test(list[0].link) : false,
  };
  if (!list.length) {
    report.stopped = "空列表";
  } else {
    const detail = await sandbox.loadDetail(list[0].link);
    report.detail = {
      idMatchesLink: detail.link === list[0].link,
      episodeCount: Array.isArray(detail.episodeItems) ? detail.episodeItems.length : null,
      firstEpisode: detail.episodeItems && detail.episodeItems[0] ? detail.episodeItems[0].episode : null,
    };
    const episode = detail.episodeItems && detail.episodeItems[0];
    if (!episode) {
      report.stopped = "详情没有选集";
    } else {
      const resources = await sandbox.loadResource({ link: episode.link });
      const resource = resources && resources[0];
      const url = resource && resource.url;
      report.play = {
        resourceCount: Array.isArray(resources) ? resources.length : 0,
        ...urlFacts(url || ""),
      };
      if (url) {
        report.playlist = await playlistPrefix(url, resource.headers || {});
      }
      report.mediaDownloaded = false;
    }
  }
} catch (error) {
  report.ok = false;
  report.error = redact(error && error.message ? error.message : error);
}

report.ok = report.error
  ? false
  : Boolean(report.playlist && report.playlist.extm3u === true && report.playlist.segmentRequests === 0);

report.calls = calls.map((call) => ({
  origin: (() => {
    try {
      return new URL(call.url).origin;
    } catch {
      return "";
    }
  })(),
  method: call.method,
  path: String(call.path || "").replace(/\/\d+(?=\/|$)/g, "/:id").replace(/ep=\d+/, "ep=:n"),
  authorization: call.authorization,
}));

console.log(JSON.stringify(report, null, 2));
if (!report.ok || !report.playlist || report.playlist.extm3u !== true || report.playlist.segmentRequests !== 0) {
  process.exit(2);
}
