# A 风格个人工作台

用户已选定 A：浅灰底、薄荷色内容区、森林绿主按钮、持续可见的侧栏。收藏、提示词、观影记录、随手存与文件小站都在同一个工作台切换。

## 行为与兼容性

- 首页直接提供工具、网站收藏与提示词入口。30 条原站提示词、5 个网站及来源完整保留在 `portal/content.js`。
- 提示词保留添加、编辑、删除、分类、全文、复制和导入导出，并增加搜索。观影记录保留原有类型、状态、评分、备注、搜索与导入导出。
- 所有提示词都有删除入口。自建提示词从当前浏览器记录删除；内置提示词通过 `cyqing_hidden_prompts` 记录移除状态，刷新和其他同源标签页保持一致，可一键恢复。移除记录仅在当前浏览器保存，不修改服务器内置内容或其他设备。
- 继续使用 `cyqing_my_prompts`、`cyqing_watchlist` 两个浏览器存储键。不会把本地记录上传到服务器；无法读取的旧记录不会被静默覆盖，仍可导出原始内容。导入遇到无效记录会拒绝整批，原有内容保持不变。
- 工作台按需加载同源工具页面，第一次进入后保留页面，切换导航不会清空视频输入、文件选择或会话。工具仍有原密码验证，保留单独打开入口及失败重连提示。
- 随手存使用原有 JSON API、CSRF、直连下载及 `/douyin/files/<id>` 预览路径。只允许同源嵌入：`X-Frame-Options: SAMEORIGIN` 和 `frame-ancestors 'self'`；其余 CSP 保持严格，不允许外部站点嵌入。
- 文件小站支持拖放、多文件选择、真实上传进度及移动布局。保留默认存储位置、`session` cookie 与所有原有路由。模板使用源文件解析后的绝对路径，兼容服务器上从旧运行路径软链启动的方式。
- 门户资源使用独立 `/portal-assets/` 白名单，避免与随手存 `/static/` 混用。代理从规范源 `portal/portal.html` 读取，保留原 Git 符号链接文件。

## 本地验证

PowerShell，工作目录为仓库根目录：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install Flask waitress yt-dlp requests
.\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -v
.\.venv\Scripts\python.exe -m unittest discover -s backend\file-drop\tests -p 'test_*.py' -v
Push-Location douyin
..\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -v
Pop-Location
```

浏览器验收使用 Node.js + Playwright 和已安装的 Edge。通过 `NODE_PATH` 指向现有 Playwright 包，或在仓库之外准备该工具依赖；不要求生产服务器安装浏览器。两个终端分别执行：

```powershell
.\.venv\Scripts\python.exe tests\serve_ui.py
# 另一个 PowerShell 终端，需已配置 playwright 包的 NODE_PATH
node tests\ui.cjs
```

预览在 http://127.0.0.1:18760 。这是隔离测试服务，视频使用模拟解析器，不会访问真实平台；文件上传下载实际发生在临时目录中。仅此测试服务的固定测试口令是 `ui-fixture-only`，不读取或替换正式站点口令。截图与报告写入被忽略的 `test-results/`。结束后 Ctrl+C 清理临时数据。

验证覆盖旧数据读取、提示词增删改查和复制、无效导入不覆盖数据、观影状态与导入导出、同源工具登录及会话共存、模拟视频解析、文件真实上传下载删除、工具状态保留、桌面与手机六个视图。默认检查尺寸为 1440×1000 与 375×812。

## 部署顺序

这是服务器常驻 Python 服务的源码变更。只更新磁盘文件不会重新载入代理的资源路由、视频 CSP 或文件模板加载逻辑。主分支存在小时同步约定，发布时需配合一次受控重启，避免只更新门户 HTML 后旧代理无法提供 `/portal-assets/`。

1. 在服务器记录当前提交（回滚点），确认工作副本干净且待发布分支测试通过；不要覆盖未提交运行修改。
2. 临时停止 `github-sync.timer`，确认当前同步任务已结束；在维护窗口将工作副本快进到已审核提交。
3. 重启 `douyin-server`、`file-drop`、`douyin-proxy` 三个服务，然后恢复 `github-sync.timer`。不改动隧道凭据、密码或用户文件。
4. 验证 `/`、`/portal-assets/style.css`、`/portal-assets/app.js`、`/portal-assets/content.js`、`/douyin`、`/files/`。前端资源应返回 200 和正确 MIME，工具应允许同源嵌入。
5. 浏览器刷新首页，检查两项工具登录和页面；用小测试文件验证上传下载删除。真实平台视频需单独检查解析、预览和下载，此前的模拟解析验收不代表线上平台成功。

若发布失败，恢复记录的回滚提交并重启上述三个服务；保留密码、用户文件与浏览器存储，不用删除数据。

本次交付创建 GitHub 改版分支和 PR；没有服务器管理连接，因此不声称已完成线上重启或真实平台下载验证。
