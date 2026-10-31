# 楚河：中国象棋学习与对弈

当前发布版本：**v1.0**（包版本 `1.0.0`）。

纯静态 HTML/CSS/JavaScript 单页应用。棋盘以 SVG 绘制，规则、棋谱校验和基础 AI 搜索在浏览器本地运行。用户可导入 `xiangqi-study/v1` UTF-8 JSON 棋谱，文件上限 2 MiB；格式定义见 [JSON Schema](docs/xiangqi-study-v1.schema.json)，导入样例见 [格式示例](examples/xiangqi-study-v1.example.json)。样例是原创格式演示，不是古谱或历史对局。

## 本地运行

上传项目目录到服务器后，在项目根目录一键部署（脚本会创建项目虚拟环境并监听 `0.0.0.0`）：

```sh
python3 scripts/deploy.py
```

Linux（必须有 systemd）：`sudo python3 scripts/deploy.py`。macOS 使用 launchd，Windows 使用任务计划程序。默认从端口 `8000` 开始；若端口被占用，自动递增检查 `8001`、`8002` 等端口。可通过 `PORT=8080` 指定其他起始端口，仍会在占用时向后顺延。部署后浏览器访问部署脚本显示的端口。停止并禁用自启动：`python3 scripts/stop.py`；Linux 用 `sudo python3 scripts/stop.py`。停止不删除服务配置或项目文件；再次执行部署会重新启用并启动。ES modules、IndexedDB 和 Service Worker 需要 HTTP(S) 页面，直接用 `file://` 打开不受支持。

Linux systemd 服务模板位于 `deploy/xiangqi.service`，部署脚本会按上传目录、运行用户和端口生成服务单元。`scripts/run_server.py` 可用于本机临时运行，但生产部署应使用 `deploy.py`，以确保服务受 systemd/launchd/任务计划管理。

GitHub Actions 每日检查 Pikafish 官方发行版与 NNUE 更新，在 CI runner 上使用 Emscripten 构建并发布版本化引擎文件。项目服务器无需 Docker；网页从公开版本清单自动下载新引擎。手机 App 的整包更新采用版本提示和用户手动下载安装包。

## 手机安装（PWA）

本站支持跨平台 PWA。将网站部署到 HTTPS 域名后，Android Chrome 可使用页面中的“安装应用”按钮；iPhone/iPad 请在 Safari 中点“分享”→“添加到主屏幕”。无需 Apple/Google 开发者账号、应用商店或 Docker。网页外壳、棋盘与本地数据可在首次打开后离线使用；Pikafish 新版本清单及引擎下载需要网络连接。升级网站后，Service Worker 会更新缓存的应用文件。

## 验证

```sh
npm test
```

## 功能现状

- 已实现标准初始局面、主要象棋走法、合法性、自将约束、将军/将死/困毙判断。
- 已实现棋谱检索、分类、JSON 导入、逐着回放、自动播放和本地持久化。
- 已实现本地双人、基础搜索 AI、兼容 Chat Completions API 的建议接口、着法合法性检查及本地降级。
- 内置库当前收录 36 盘现代大师对局和 40 盘残局，共 76 盘，着法均通过规则校验。现代/残局数据源为 [Chinese Chess Practical Dataset（CC BY 4.0）](https://github.com/Yvonne761/Chinese-Chess-Practical-Dataset)，来源、版本和归属见 `data/ATTRIBUTION.md`。古谱《梅花谱》《橘中秘》《适情雅趣》尚未录入；100 盘首版目标未达成，不应将当前版本视为完整内容交付。
- 首版导入仅支持 `xiangqi-study/v1` JSON（最大 2 MiB）；XQF、PGN、ICCS 文本解析仍延后。
- 内置 AI 棋力未经认证；API 模型强度无法与引擎等级等同。API 密钥存于当前浏览器 IndexedDB，浏览器直连服务商存在密钥暴露与 CORS 限制。
- 自托管静态文件可由 HTTPS 静态站点托管；首版无后端进程，因此无需 systemd 服务。
