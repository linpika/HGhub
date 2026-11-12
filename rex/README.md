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

2026-11-12 检查过当时的源码地址：HTTP 200，`Content-Type: text/plain; charset=utf-8`，正文就是这份脚本。已知能用链接安装的 `rex-home.js` 也是 GitHub raw 的 `text/plain`，所以失败不是 404，也不是这个 Content-Type 单独造成的。

公开可下载的官方模块 `https://assets.rexnow.tv/scripts/rex-tmdb.js` 和 `https://assets.rexnow.tv/scripts/bangumi.js` 都以 `WidgetMetadata = {` 开头，并带 `requiredVersion: "0.0.1"` 和 `modules`。本文件先前在完整声明前面又放了一段只有编号和标题的 `/* WidgetMetadata { ... } */`。按第一段声明取值的解析器会得到一份没有 `modules` 的元数据。0.1.1 改成与上述官方脚本相同的单份声明。这还没有在真机上复测。

已在 Rex 使用记录里出现的安装方式有两种，见 [kenxtbecdi7690/rex-home 新手教学](https://github.com/kenxtbecdi7690/rex-home/blob/main/新手教学.md) 和 [模块工具教学](https://github.com/kenxtbecdi7690/rex-home/blob/main/模块工具教学.md)：

1. 用模块页的链接安装，地址是：

```text
https://raw.githubusercontent.com/linpika/HGhub/cursor/rex-hghub-module-99df/rex/hghub.widget.js
```

2. 模块页「＋」→ 从文件导入 `rex/hghub.widget.js`。

`rex://widget?url=` 只写在第三方仓库 [Rex-Widgets-Hub](https://github.com/MakkaPakka518/Rex-Widgets-Hub) 的 README 里。按真实备份整理的 [导入导出规则](https://github.com/kenxtbecdi7690/rex-home/blob/main/导入导出规则.md) 把合集链接格式标为未确认，所以不要把这条自定义协议当成已经验证的安装方法。

## 真机上看一条影片

1. 用上面的 https 链接，或模块页「＋」从文件导入 0.1.1。导入失败就停，并记下 Rex 版本、用的是链接还是文件，以及完整失败提示。
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
| 导入 | 文档讲的是 Forward，不是 Rex | 官方脚本以 `WidgetMetadata =` 开头。新手教学用 https raw 链接安装；模块工具教学写模块页「＋」从文件导入。`rex://widget?url=` 只有第三方面板文档 | 文件以单份 `WidgetMetadata =` 开头。安装说明改为 https 链接或从文件导入 |

不能从这些页面推出「Forward 模块可以直接安装到 Rex」。InchStudio 的公开仓库里没有 Rex 应用仓库。`@rexnow/libs` 的作者仓库是 `baranwang/rex-widget-libs`，许可证是 MIT，它是社区类型库，不是 Rex 应用源码。

## 2026-11-12 云端探针

`node rex/test-widget.mjs`：9 项通过，0 项失败。合成响应，没有访问站点。

`node rex/probe-public.mjs`：退出码 0。固定线路游客请求返回 20 条列表，抽到的编号是 12，详情有 21 集。播放接口给出 HTTPS 地址，主机名为 `yd-lphu-long.hzjvlo.cn`，路径以 `.m3u8` 结尾并带查询串。随后只读了 4096 字节，内容以 `#EXTM3U` 开头，HTTP 200，没有跟随重定向，也没有请求分片。请求不带 `Authorization`。这不是 Rex 真机播放。
