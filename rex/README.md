# HGhub Rex 模块

这是一个单文件 JavaScript 模块：`rex/hghub.widget.js`。它只复用本仓库客户端已经在用的游客读接口，提供最新列表、影片详情和起播时的播放地址。原来的 Tauri 应用没有改行为。

模块固定请求 `https://huangguoai.com/api/edge/request`。它不登录、不保存口令、不携带 `Authorization`，也不在失败后改走 `huangguoai.ai` 或镜像。封面仍由原客户端本地解密；模块不嵌入那把密钥，因此不返回封面地址。

许可证与仓库相同：[PolyForm Noncommercial 1.0.0](../LICENSE)。模块文件头带有许可证要求的 `Required Notice`。

## 代码验收

```bash
node rex/test-widget.mjs
```

或 `pnpm test:rex`。测试把合成响应注入 `Widget.http`，检查列表 → 详情 → 播放地址，以及空列表、缺地址、拒绝访问和不兼容响应。通过只说明这套代码按约定处理了这些响应。它没有访问真实站点，也没有播放视频。

公开游客链路的最小探针（只取一页目录、一条详情和一个播放地址，不下载影片）：

```bash
node rex/probe-public.mjs
```

探针打印编号、集数、地址是否为 HTTPS、主机名，以及路径是否以 `.m3u8` 结尾。它接着只读取播放列表前 4096 字节，确认是否以 `#EXTM3U` 开头，然后取消连接；不请求分片，也不打印标题、查询串、完整地址或列表正文。退出码 `0` 表示接口返回了 HTTPS 地址，且这份列表前缀是 HLS 播放列表。退出码 `2` 表示接口失败、没有可播放地址，或列表前缀不是 HLS。两种结果都不是 Rex 真机播放成功。

## 安装

本环境没有 Rex 真机，下面只写已经在公开文档里出现过的导入方式。

`rex/hghub.widget.js` 是要安装的模块文件。社区仓库 [MakkaPakka518/Rex-Widgets-Hub](https://github.com/MakkaPakka518/Rex-Widgets-Hub) 的 README 写明：

- Rex 模块是 JavaScript，可用文件头的 `WidgetMetadata` 注释或 `WidgetMetadata =` 声明 `id`、`title`、`version`、`author`。
- 客户端导入链接形如 `rex://widget?url=<模块源码的 HTTPS 地址>`。
- 合集订阅是另一份 JSON，路径以 `.rex` 结尾；其中每个模块仍通过 `url` 指向 JS 源码。

本分支文件推送后，对应的源码地址是：

```text
https://raw.githubusercontent.com/linpika/HGhub/cursor/rex-hghub-module-99df/rex/hghub.widget.js
```

在系统能把 `rex://` 交给 Rex 时，可打开：

```text
rex://widget?url=https%3A%2F%2Fraw.githubusercontent.com%2Flinpika%2FHGhub%2Fcursor%2Frex-hghub-module-99df%2Frex%2Fhghub.widget.js
```

没有查到 Rex 应用官方的「从本地文件安装」菜单说明，所以这里不写设置项名称。真机是否接受上述链接、是否执行 `loadFeed` / `loadDetail` / `loadResource`，都还没验证。

## 真机上看一条影片

1. 用上面的链接导入模块。导入失败就停，不要改模块去猜别的入口。
2. 打开模块里的「最新」，确认能看到一页条目标题。封面预期为空，因为模块故意不返回加密封面。
3. 点开一条，确认详情里有选集。没有选集就停。
4. 点一集。播放器应调用 `loadResource`，向固定线路取播放地址。能开始播放才算这条链路在真机上通过。
5. 若提示需要登录、HTTP 401/403，或播放地址为空，模块会停在错误上。不要换线路，也不要填账号。

## 不在本模块里的事

登录、注册、评论、收藏、关注、搜索、分类、排行和文章都留在原应用。模块也不代理 HLS 分片，不改写播放列表，不下载整部影片。

## 兼容证据

逐项来源和不能证明的地方见仓库说明时的调查记录。这里只固定模块实际采用的交集：

| 字段或行为 | Forward 文档 | Rex 社区类型 `@rexnow/libs@3.1.3` | 本模块 |
| --- | --- | --- | --- |
| `WidgetMetadata` 的 id、title、description、author、site、version、modules、detailCacheDuration | README 有 | `metadata.ts` 有，并把 `requiredVersion` 注释写成「所需 Rex 版本」 | 使用这些字段。`requiredVersion` 没有公开的 Rex 版本号，因此不写 |
| 列表模块 `functionName` + `type: "page"` | README 有 | `metadata.ts` 有 | `loadFeed`，页码参数 `page` |
| `loadDetail(link)` 为顶层函数 | README 有 | `video.ts` 声明 `(link: string)` | 只接受 `hghub:video:{id}` 字符串 |
| `loadResource`，`id: "loadResource"`，`type: "stream"`，`cacheDuration: 0` | README 有 | `metadata.ts` 有 | 按此声明 |
| 返回 `{ name, url, description?, customHeaders?, playerType? }` | README 有 | `stream.ts` 还有同级字段 `headers` | 两个头字段写入同一组 Referer 和 User-Agent。应用读哪一个尚未证实 |
| `Widget.http.post(url, body, options)`，读 `response.data` | README 有 | 测试适配器返回 `{ data, statusCode }` | 两者都读取。缺少 `data` 或 HTTP 状态码就失败 |
| 条目 `type` | README 列出 url、douban、imdb、tmdb，后文另有 forward | 联合类型多了 `detail` | 使用 `detail`。Forward 正文没有这个类型的行为说明，真机是否用它打开 `loadDetail` 尚未证实 |
| 导入 | 文档讲的是 Forward，不是 Rex | 官方应用手册未找到 | 只采用 Rex-Widgets-Hub README 里的 `rex://widget?url=` |

不能从这些页面推出「Forward 模块可以直接安装到 Rex」。InchStudio 的公开仓库里没有 Rex 应用仓库。`@rexnow/libs` 的作者仓库是 `baranwang/rex-widget-libs`，许可证是 MIT，它是社区类型库，不是 Rex 应用源码。

## 2026-11-12 云端探针

`node rex/test-widget.mjs`：9 项通过，0 项失败。合成响应，没有访问站点。

`node rex/probe-public.mjs`：退出码 0。固定线路游客请求返回 20 条列表，抽到的编号是 12，详情有 21 集。播放接口给出 HTTPS 地址，主机名为 `yd-lphu-long.hzjvlo.cn`，路径以 `.m3u8` 结尾并带查询串。随后只读了 4096 字节，内容以 `#EXTM3U` 开头，HTTP 200，没有跟随重定向，也没有请求分片。请求不带 `Authorization`。这不是 Rex 真机播放。
