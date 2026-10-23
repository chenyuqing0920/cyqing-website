# 微信桥接（ClawBot / iLink Bot 协议）

微信只做消息通道：桥接程序在 Muse 的云电脑上长轮询收消息，
Muse 被调度唤醒后用工具执行任务，回复经桥接程序发回微信。

## 常用操作（在本目录下）
- 查看状态：`.venv/bin/python bridge.py status`
- 启动服务：`./start.sh`
- 停止服务：`./stop.sh`
- 重新登录：`.venv/bin/python bridge.py login` 后扫码，再
  `.venv/bin/python bridge.py wait-login`，然后 `./start.sh`
- 日志：`logs/bridge.log`（服务输出 `logs/serve.out`）

## 说明
- 凭据只存在 `state/session.json`（权限 0600），不要外传、不要提交仓库。
- `state/`、`inbox/`、`outbox/`、`logs/` 已被 .gitignore 排除。
- 收到 `ret/errcode = -14` 表示账号会话被服务端暂停 1 小时（不是凭据过期），
  程序会自动等待并恢复，状态里会显示 session_paused。
- 若长时间不回复：先看 status 中 serve_running、outbox/pending、inbox/new，
  再看 logs/bridge.log 最后几行。
