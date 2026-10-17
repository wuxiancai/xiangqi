# Pikafish 浏览器引擎

此目录提供基于官方 Pikafish 源码的可选 WebAssembly 构建入口。默认仓库不携带引擎二进制或 NNUE 网络；使用者自行构建后，资源保存在 `engine/pikafish/dist/`，该目录已从 Git 排除。

## 构建

需要 Git、Docker 和可访问 GitHub 的网络。运行：

```sh
bash engine/pikafish/build.sh
```

脚本固定 Pikafish 源码版本，应用浏览器 UCI 包装补丁，使用 Emscripten Docker 镜像构建，并下载带 SHA-256 校验的匹配 NNUE 网络。首次构建会下载约数十 MiB 网络和编译工具镜像。应用通过同源 Worker 加载资源；多线程版要求服务端发送 COOP/COEP 隔离头。

## 许可与来源

- 引擎源码及本目录的浏览器包装补丁：GNU GPL-3.0-or-later。上游：[official-pikafish/Pikafish](https://github.com/official-pikafish/Pikafish)。重新分发构建产物时必须同时提供对应源码、修改补丁与 GPL 文本。
- NNUE 网络遵守 Pikafish 团队单独的 [NNUE-License.md](./NNUE-License.md)：仅限合法用途，未获许可不得商业使用。下载者需自行确认用途符合网络许可。
- `worker.js` 的 UCI Worker 形状参考 [brianhliou/pikafish-wasm](https://github.com/brianhliou/pikafish-wasm)，此项目同为 GPL-3.0-or-later；源码修改及来源版本记在 `NOTICE.md`。

若不构建该引擎，应用继续使用原有本地搜索 AI；不会显示 Pikafish 已就绪或伪造引擎分析。
