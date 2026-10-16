# 棋谱数据来源与授权

## 近现代大师对局

- 数据集：Chinese Chess Practical Dataset (CCPD)，作者 Yu-Han Tseng 与 Bo-Nian Chen。
- 来源仓库：https://github.com/Yvonne761/Chinese-Chess-Practical-Dataset
- 固定版本：`368a47a947773dd8692c026e286dd19b6277b993`
- 数据集声明许可：Creative Commons Attribution 4.0 International (CC BY 4.0)。
- 本项目处理：从作者标注的“大師對局”中选取样本，将 Big5 编码 PGN 的中文记谱转为本项目 `xiangqi-study/v1` ICCS 着法，过滤未能完整解析或不能通过本地合法走法校验的记录。原始来源链接随每盘记录保留。
- 再分发：保留作者/数据集署名、来源链接、许可说明和本项目修改说明；不表示作者为本项目背书。CC BY 4.0 要求见 https://creativecommons.org/licenses/by/4.0/ 。
- 数据范围：本地库包含至少 30 盘大师对局及 40 盘残局记录；两类均来自该 CC BY 4.0 数据集。
- 可复现：运行 `node scripts/import-ccpd.mjs`；脚本会访问固定版本 GitHub API 与原始文件，未选取/未校验的条目不会写入库中。

## 古谱

目前尚未将古谱转录加入应用数据。古籍原文年代久远不代表任意现代校订、评注和电子转录都可自由再发布。加入《梅花谱》《橘中秘》《适情雅趣》选段前，须逐个登记底本版本、可访问来源、许可依据及转录/校验记录。
