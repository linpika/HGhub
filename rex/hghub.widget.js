WidgetMetadata = {
  id: "hghub.library",
  title: "HGhub",
  description: "在播放器里浏览 HGhub 已使用的公开游客目录，并在起播时解析播放地址。不含登录、收藏或评论。",
  author: "HGhub",
  site: "https://huangguoai.com",
  version: "0.1.1",
  requiredVersion: "0.0.1",
  detailCacheDuration: 60,
  modules: [
    {
      id: "feed",
      title: "最新",
      description: "游客视频列表，每页 20 条。",
      requiresWebView: false,
      functionName: "loadFeed",
      sectionMode: false,
      cacheDuration: 120,
      params: [
        {
          name: "page",
          title: "页码",
          type: "page",
          description: "从 1 开始",
          value: "1",
        },
      ],
    },
    {
      id: "loadResource",
      title: "播放地址",
      description: "起播时向原播放接口取当前地址。",
      functionName: "loadResource",
      type: "stream",
      cacheDuration: 0,
      params: [],
    },
  ],
};

// Required Notice: Copyright (c) 2026 HGhub contributors (https://github.com/Minireel/HGhub)
// License: PolyForm Noncommercial 1.0.0
// https://polyformproject.org/licenses/noncommercial/1.0.0
// 同一仓库内的非商业派生文件。不包含登录凭据或封面解密密钥。

var HGhubWidget = (function () {
  var ORIGIN = "https://huangguoai.com";
  var EDGE = ORIGIN + "/api/edge/request";
  var USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  var PAGE_SIZE = 20;

  function fail(message) {
    throw new Error(message);
  }

  function base64Ascii(text) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var bytes = [];
    var i;
    for (i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code > 0x7f) fail("请求体含非 ASCII，已拒绝");
      bytes.push(code);
    }
    var out = "";
    var j;
    for (j = 0; j < bytes.length; j += 3) {
      var a = bytes[j];
      var b = j + 1 < bytes.length ? bytes[j + 1] : 0;
      var c = j + 2 < bytes.length ? bytes[j + 2] : 0;
      var triple = (a << 16) | (b << 8) | c;
      out += alphabet[(triple >> 18) & 63];
      out += alphabet[(triple >> 12) & 63];
      out += j + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
      out += j + 2 < bytes.length ? alphabet[triple & 63] : "=";
    }
    return out;
  }

  function positiveInt(value, label) {
    var text = String(value == null ? "" : value).trim();
    if (!/^[1-9]\d{0,8}$/.test(text)) fail(label + "无效");
    return text;
  }

  function rejectSecrets(params) {
    if (!params || typeof params !== "object") return;
    if (params.token || params.password || params.authorization || params.cookie) {
      fail("模块不接受登录凭据");
    }
  }

  function readHttp(response) {
    if (!response || typeof response !== "object" || !Object.prototype.hasOwnProperty.call(response, "data")) {
      fail("响应结构与 Widget.http 文档不一致");
    }
    var status = typeof response.statusCode === "number" ? response.statusCode : response.status;
    if (typeof status !== "number" || status < 100 || status > 599) {
      fail("响应缺少 HTTP 状态码");
    }
    return { status: status, data: response.data };
  }

  function parsePayload(data) {
    var payload = data;
    if (typeof payload === "string") {
      if (!payload.trim()) fail("接口响应为空");
      try {
        payload = JSON.parse(payload);
      } catch (error) {
        fail("接口响应不是 JSON");
      }
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      fail("接口响应不是 JSON 对象");
    }
    if (payload.status !== 1) {
      var msg = typeof payload.msg === "string" && payload.msg.trim() ? payload.msg.trim() : "接口返回失败";
      fail(msg);
    }
    if (payload.data == null) fail("接口没有数据");
    return payload.data;
  }

  function accessDenied(status) {
    return status === 401 || status === 403;
  }

  async function edge(http, method, path, body) {
    if (!http || typeof http.post !== "function") fail("当前环境没有 Widget.http.post，无法请求");
    var envelope = {
      method: method,
      path: path,
      body: body == null ? "" : base64Ascii(JSON.stringify(body)),
      content_type: body == null ? "" : "application/json",
    };
    var response = await http.post(EDGE, envelope, {
      headers: {
        Accept: "application/json",
        Referer: ORIGIN + "/",
        "User-Agent": USER_AGENT,
      },
    });
    var httpResult = readHttp(response);
    if (accessDenied(httpResult.status)) {
      fail("访问被拒绝（HTTP " + httpResult.status + "）。模块不会更换线路，也不会附带登录凭据。");
    }
    if (httpResult.status >= 300 && httpResult.status < 400) fail("业务接口重定向已拒绝");
    if (httpResult.status < 200 || httpResult.status >= 300) {
      fail("服务器请求失败（HTTP " + httpResult.status + "）");
    }
    return parsePayload(httpResult.data);
  }

  function textOrEmpty(value) {
    return typeof value === "string" ? value : "";
  }

  function httpsUrl(value) {
    if (typeof value !== "string") return "";
    var url = value.trim();
    if (!/^https:\/\//i.test(url) || /\s/.test(url)) return "";
    return url;
  }

  function playUrlOf(info) {
    if (!info || typeof info !== "object" || Array.isArray(info)) return "";
    var streams = info.streams && typeof info.streams === "object" ? info.streams : {};
    return httpsUrl(streams.main) || httpsUrl(info.video_url);
  }

  function isAccessError(error) {
    return /访问被拒绝（HTTP (401|403)）/.test(String(error && error.message));
  }

  function cardItem(card) {
    if (!card || typeof card !== "object" || Array.isArray(card)) fail("列表里有无法识别的条目");
    var id = positiveInt(card.id, "影片编号");
    if (typeof card.title !== "string" || !card.title.trim()) fail("列表条目缺少标题");
    var episodes = Number(card.episode_count);
    var item = {
      id: id,
      type: "detail",
      title: card.title,
      link: "hghub:video:" + id,
      mediaType: episodes > 1 ? "tv" : "movie",
    };
    if (typeof card.description === "string" && card.description) item.description = card.description;
    if (typeof card.score === "number") item.rating = String(card.score);
    if (typeof card.created_at === "string" && card.created_at) item.releaseDate = card.created_at;
    if (Array.isArray(card.tags) && card.tags.length) {
      item.genreTitle = card.tags.filter(function (tag) { return typeof tag === "string" && tag; }).join(" / ");
    }
    return item;
  }

  function episodeItem(videoId, episode) {
    if (!episode || typeof episode !== "object") fail("选集无法识别");
    var ep = positiveInt(episode.ep_num, "选集编号");
    var item = {
      id: videoId + ":" + ep,
      type: "detail",
      title: textOrEmpty(episode.title).trim() || ("第 " + ep + " 集"),
      link: "hghub:video:" + videoId + ":" + ep,
      episode: Number(ep),
      mediaType: "tv",
    };
    if (typeof episode.duration === "number" && episode.duration >= 0) item.duration = episode.duration;
    return item;
  }

  function parseLink(link) {
    var match = /^hghub:video:([1-9]\d{0,8})(?::([1-9]\d{0,8}))?$/.exec(typeof link === "string" ? link.trim() : "");
    if (!match) fail("详情参数必须是列表条目的 link 字符串");
    return { id: match[1], ep: match[2] || "" };
  }

  async function loadFeed(params, http) {
    params = params || {};
    rejectSecrets(params);
    if (params.genreId || params.peopleId) fail("这个模块没有分类或人物列表");
    var page = params.page == null || params.page === "" ? "1" : positiveInt(params.page, "页码");
    var data = await edge(http, "GET", "/api/videos?page=" + page + "&size=" + PAGE_SIZE, null);
    if (!data || typeof data !== "object" || !Array.isArray(data.items)) fail("列表响应缺少 items 数组");
    return data.items.map(cardItem);
  }

  async function loadDetail(link, http) {
    rejectSecrets(typeof link === "object" ? link : null);
    var parsed = parseLink(link);
    var data = await edge(http, "GET", "/api/videos/" + parsed.id, null);
    if (!data || typeof data !== "object" || Array.isArray(data)) fail("详情响应无法识别");
    var id = positiveInt(data.id, "影片编号");
    if (id !== parsed.id) fail("详情响应的影片编号与请求不一致");
    if (typeof data.title !== "string" || !data.title.trim()) fail("详情响应缺少标题");
    if (!Array.isArray(data.episodes)) fail("详情响应缺少选集");
    var episodes = data.episodes.map(function (episode) { return episodeItem(id, episode); });
    var item = {
      id: id,
      type: "detail",
      title: data.title,
      link: "hghub:video:" + id,
      description: textOrEmpty(data.description),
      mediaType: episodes.length > 1 ? "tv" : "movie",
      episodeItems: episodes,
    };
    if (typeof data.score === "number") item.rating = String(data.score);
    if (typeof data.created_at === "string" && data.created_at) item.releaseDate = data.created_at;
    if (Array.isArray(data.tags) && data.tags.length) {
      item.genreTitle = data.tags.filter(function (tag) { return typeof tag === "string" && tag; }).join(" / ");
    }
    return item;
  }

  async function resolvePlay(http, id, ep) {
    var primaryError = null;
    try {
      var primary = await edge(http, "POST", "/api/videos/" + id + "/episodes/" + ep + "/playback", {});
      var primaryUrl = playUrlOf(primary);
      if (primaryUrl) return primaryUrl;
    } catch (error) {
      if (isAccessError(error)) throw error;
      primaryError = error;
    }
    try {
      var legacy = await edge(http, "GET", "/api/videos/" + id + "/play?ep=" + ep + "&page_texts=0", null);
      var legacyUrl = playUrlOf(legacy);
      if (legacyUrl) return legacyUrl;
    } catch (error) {
      if (isAccessError(error) || primaryError) throw (primaryError || error);
      throw error;
    }
    if (primaryError) throw primaryError;
    fail("播放接口没有返回可用地址");
  }

  function resource(url) {
    var headers = {
      Referer: ORIGIN + "/",
      "User-Agent": USER_AGENT,
    };
    var item = {
      name: "主线路",
      url: url,
      playerType: "app",
      customHeaders: headers,
      headers: headers,
    };
    if (/\.m3u8(\?|$)/i.test(url)) item.description = "HLS";
    return [item];
  }

  async function loadResource(params, http) {
    params = params || {};
    rejectSecrets(params);
    var parsed = parseLink(params.link);
    var ep = parsed.ep;
    if (!ep && params.episode != null && params.episode !== "") ep = positiveInt(params.episode, "选集编号");
    if (!ep) fail("缺少选集编号");
    var url = await resolvePlay(http, parsed.id, ep);
    return resource(url);
  }

  return {
    ORIGIN: ORIGIN,
    EDGE: EDGE,
    base64Ascii: base64Ascii,
    loadFeed: loadFeed,
    loadDetail: loadDetail,
    loadResource: loadResource,
  };
})();

async function loadFeed(params) {
  return HGhubWidget.loadFeed(params, Widget.http);
}

async function loadDetail(link) {
  return HGhubWidget.loadDetail(link, Widget.http);
}

async function loadResource(params) {
  return HGhubWidget.loadResource(params, Widget.http);
}
