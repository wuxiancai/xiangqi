# Pikafish 浏览器引擎

此目录提供基于官方 Pikafish 源码的可选 WebAssembly 构建入口。默认仓库不携带引擎二进制或 NNUE 网络；资源保存在 `engine/pikafish/dist/`，该目录已从 Git 排除。

## 构建

手动构建需要 Git、Emscripten SDK（提供 `em++`）和可访问 GitHub 的网络。运行：

```sh
bash engine/pikafish/build.sh
```

手动构建脚本默认使用固定源码版本，应用浏览器 UCI 包装补丁，直接使用 Emscripten 编译，并下载带 SHA-256 校验的匹配 NNUE 网络。应用通过同源 Worker 加载资源；多线程版要求服务端发送 COOP/COEP 隔离头。

GitHub Actions 每日检查官方 Pikafish 稳定版及官方 Networks 的 NNUE。检测到更新后，在 GitHub 托管的 Linux runner 上安装 Emscripten SDK、构建 WASM，核对 SHA-256 和 WASM 文件头，再发布到 `engine-updates` 分支。构建及发布流程不依赖项目服务器上的 Docker。

网页打开 Pikafish 时读取 `engine-updates/manifest.json`，按版本从 GitHub Raw CDN 下载并校验引擎脚本、WASM 和 NNUE；下载或校验失败时使用上一个发布版或本地引擎。服务器需通过 HTTPS 提供 COOP/COEP 响应头。更新完成后重新打开网页即可使用新版本。

本仓库目前只有网页工程，尚无 Android/iOS 原生工程。将来手机 App 的整包更新由 App 自己读取版本清单并弹窗，用户确认后下载对应安装包；安卓需要用户确认系统安装提示。iOS 的 IPA 需要有效签名和对应的分发方式，普通网页下载不能直接完成安装。

## 许可与来源

- 引擎源码及本目录的浏览器包装补丁：GNU GPL-3.0-or-later。上游：[official-pikafish/Pikafish](https://github.com/official-pikafish/Pikafish)。重新分发构建产物时必须同时提供对应源码、修改补丁与 GPL 文本。
- NNUE 网络遵守 Pikafish 团队单独的 [NNUE-License.md](./NNUE-License.md)：仅限合法用途，未获许可不得商业使用。下载者需自行确认用途符合网络许可。
- `worker.js` 的 UCI Worker 形状参考 [brianhliou/pikafish-wasm](https://github.com/brianhliou/pikafish-wasm)，此项目同为 GPL-3.0-or-later；源码修改及来源版本记在 `NOTICE.md`。

若不构建该引擎，应用继续使用原有本地搜索 AI；不会显示 Pikafish 已就绪或伪造引擎分析。
