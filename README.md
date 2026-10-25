# cyqing-website

陈玉庆的个人网站（tool.cyqing.icu）全套代码：个人工作台 + 随手存（抖音下载）+ 文件小站 + 隧道运维，与服务器工作副本每小时自动同步。本仓库只放网站相关内容。

线上入口：https://tool.cyqing.icu （工作台内切换收藏、提示词、观影记录与两个工具；保留 /douyin、/files/ 独立入口）

## 结构

| 目录 | 内容 |
|---|---|
| `portal/` | 浅色个人工作台：portal.html、style.css、app.js、content.js；工具同页显示，切换时保留状态 |
| `douyin/` | 随手存 · 抖音视频下载（解析器、桌面版、网页版、测试） |
| `backend/stack/` | 前门代理 proxy.py（7860）、总启动脚本 start.sh、systemd 单元源文件 |
| `backend/file-drop/` | 文件小站 app.py（7864）；files/ 与 data/ 为运行时数据，不入库 |
| `backend/github-sync/` | 与 GitHub 每小时双向同步的脚本与单元 |
| `cloudflare-lab/` | 网站的 Cloudflare 隧道：cloudflared 代理版补丁与构建记录（让官方隧道客户端走 HTTP 代理） |
| `tests/` | 门户路由测试与完整工作台浏览器测试；隔离文件数据，视频使用模拟解析器 |

改版结构、测试方法与部署顺序见 [工作台改版说明](docs/workspace-redesign.md)。无前端构建或 npm 运行依赖。

## 同步约定

- 本仓库是唯一权威版本：改代码先改这里，服务器从这里运行（原运行路径均为指向本仓库的软链）。
- 每小时脚本自查：有改动自动提交并推送；GitHub 侧有改动则拉取。冲突时脚本停下记录日志，不自动裁决。
- 密钥、会话、用户文件、虚拟环境、二进制产物一律由 .gitignore 排除。
