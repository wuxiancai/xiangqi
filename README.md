# 楚河：中国象棋学习与对弈

纯静态 HTML/CSS/JavaScript 单页应用。棋盘以 SVG 绘制，规则、棋谱校验和基础 AI 搜索在浏览器本地运行。用户可导入多种棋谱文件并转换为应用内部 JSON；格式定义见 [JSON Schema](docs/xiangqi-study-v1.schema.json)，导入样例见 [格式示例](examples/xiangqi-study-v1.example.json)。样例是原创格式演示，不是古谱或历史对局。

## 本地运行

上传项目目录到服务器后，在项目根目录一键部署（脚本会创建项目虚拟环境并监听 `0.0.0.0`）：

```sh
python3 scripts/deploy.py
```

Linux（必须有 systemd）：`sudo python3 scripts/deploy.py`。macOS 使用 launchd，Windows 使用任务计划程序。默认端口 `8000`，Linux/macOS 可用 `PORT=8080` 修改。部署后浏览器访问 `http://<主机地址>:<端口>`。停止并禁用自启动：`python3 scripts/stop.py`；Linux 用 `sudo python3 scripts/stop.py`。停止不删除服务配置或项目文件；再次执行部署会重新启用并启动。ES modules、IndexedDB 和 Service Worker 需要 HTTP(S) 页面，直接用 `file://` 打开不受支持。

Linux systemd 服务模板位于 `deploy/xiangqi.service`，部署脚本会按上传目录、运行用户和端口生成服务单元。`scripts/run_server.py` 可用于本机临时运行，但生产部署应使用 `deploy.py`，以确保服务受 systemd/launchd/任务计划管理。

## 验证

```sh
npm test
```

## 功能现状

- 已实现标准初始局面、主要象棋走法、合法性、自将约束、将军/将死/困毙判断。
- 已实现棋谱检索、分类、多格式棋谱导入、逐着回放、自动播放和本地持久化。
- 已实现本地双人、本地搜索 AI（默认最强；迭代加深、置换表、主变/历史着法排序、吃子延伸及位置评分）、兼容 Chat Completions API 的建议接口、着法合法性检查及本地降级；AI 棋力尚未经对局基准认证。
- 对方可合法吃子的棋子按己方回吃保护状态提示：有保护为红圈，无保护为绿圈；普通落子播放清脆音调，吃子播放低音加双重木击声，红黑双方一致。
- 内置库当前收录 36 盘现代大师对局和 40 盘残局，共 76 盘，着法均通过规则校验。现代/残局数据源为 [Chinese Chess Practical Dataset（CC BY 4.0）](https://github.com/Yvonne761/Chinese-Chess-Practical-Dataset)，来源、版本和归属见 `data/ATTRIBUTION.md`。古谱《梅花谱》《橘中秘》《适情雅趣》尚未录入；100 盘首版目标未达成，不应将当前版本视为完整内容交付。
- 多格式导入详见下方说明；旧版二进制 DOC、加密文档和棋盘截图局面识别暂不支持。
- 内置 AI 棋力未经认证；API 模型强度无法与引擎等级等同。API 密钥存于当前浏览器 IndexedDB，浏览器直连服务商存在密钥暴露与 CORS 限制。
- 自托管静态文件可由 HTTPS 静态站点托管；首版无后端进程，因此无需 systemd 服务。
## 导入棋谱

棋谱库支持导入 `xiangqi-study/v1` JSON，以及 XQF、TXT、Markdown、PGN/ICCS/FEN 文本、DOCX、PDF 和常见图片（PNG/JPEG/WebP/BMP/TIFF）。可点击“导入文件夹”批量导入所选目录及其子目录中的 XQF 文件；逐盘解码并校验，成功批量保存，失败文件跳过并显示原因，重复路径自动跳过。XQF 会在本机解码，再逐着转换为可检查的 ICCS 坐标文本和内部记录；其他非 JSON 格式先提取/识别文本，显示可编辑预览后逐着校验。所有着法都必须通过本地象棋规则校验，非法时不会部分导入。单文件上限 500 MiB。

PDF、DOCX 与图片解析组件在首次使用时从 jsDelivr 加载；中文 OCR 使用 Tesseract.js 与简体中文识别模型。文件内容在当前浏览器本地处理，不会上传。扫描 PDF 会逐页 OCR。旧版二进制 DOC、加密文档以及未列出的专有格式需先转为支持的格式；棋谱图片须清晰展示可识别的中文记谱，棋盘局面截图暂不自动识别为着法。
