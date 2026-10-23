# Cloudflare 稳定连接 — 实验与部署记录

目标：Muse VM 内的网站（127.0.0.1:7860 门户）经 Cloudflare 稳定对外，
域名 tool.cyqing.icu，不用 Serveo/localhost.run，不依赖个人电脑。

## 结论（2026-10-21 实测）

**方案 A 跑通（网络层已用 cloudflared 自身代码验证）。**
自编译的代理版 cloudflared 已能完成：边缘发现 → 经 HTTP 代理 CONNECT
7844 → 与真实 Cloudflare 边缘节点 TLS 1.3 握手（证书为 CloudFlare
Origin CA 签发的 *.cftunnel.com，校验通过）。探针连续 4/4 成功。
剩下的是账号侧开通（命名隧道 + 域名 NS 迁到 Cloudflare），不是网络障碍。

## 已证伪/已修正的旧判断

- “代理禁止 CONNECT 7844”——错。代理对 region*.v2.argotunnel.com:7844
  返回 200。失败真因是官方 cloudflared 根本不读代理环境变量、直连被拦。
- PR #1514 对本机无用：它只改 ingress/origin_*（到源站的拨号），没碰
  边缘拨号；维护者也未能验证、未合并。
- 系统 DNS 是 fake-IP（198.18.0.0/15）且 SRV 查询被 REFUSED——官方版
  的边缘发现同样过不去，其 DoT 兜底直连 1.1.1.1:853 也必失败。
- 快速隧道（trycloudflare）申请被 api.trycloudflare.com 的防滥用 WAF
  拦截（403 "Your request was blocked"，与出口共享 IP 有关）。
  命名隧道不走这个接口，不受影响；api.cloudflare.com 管理接口实测
  可达（无令牌返回标准 JSON 403）。

## 补丁（cloudflared-proxy.patch，基于上游 master，自编译）

1. `edgediscovery/dial.go`（核心）：DialEdge 是唯一的边缘 TCP 拨号。
   有代理环境变量时，先向代理发 CONNECT 建立隧道，再在其上做端到端
   TLS（证书校验不变）。关键细节：CONNECT 目标用 region 主机名而非
   单个边缘 IP——实测单 IP 成功率约 2/8（代理 10 秒无兜底即放弃），
   主机名约 7/8（代理内部跨 10 个地址兜底）；按 198.41.192.0/24 →
   region1、198.41.200.0/24 → region2 映射。CONNECT+握手失败自动换
   新连接重试（最多 4 次，单次 CONNECT 上限 12 秒）。
2. `edgediscovery/allregions/discovery.go`：有代理时，SRV/A 记录改走
   DoH（https://dns.google/resolve，经代理出网），拿到真实边缘 IP。
   可用 CLOUDFLARED_DISABLE_DOH=1 关闭。
3. `cmd/cloudflared/tunnel/quick_tunnel.go`、`cfapi/base_client.go`、
   `diagnostic/client.go`：自定义 http.Transport 补上
   `Proxy: http.ProxyFromEnvironment`（Go 里自建 Transport 不设 Proxy
   即直连——这是快速隧道申请最初 TLS 失败的原因）。

构建：Go 1.27.3（~/workspace/tools/go），`go build ./cmd/cloudflared`。
单元测试：edgediscovery / allregions / cfapi / diagnostic /
cmd/cloudflared/tunnel 全部通过。
探针源码：cloudflared-src/cmd/edgeprobe（可重复验证网络链路）。

## 证据（edgeprobe 实测输出，2026-10-21 18:26）

```
DISCOVERY_OK
EDGE_TLS_OK[0] 198.41.200.43:7844 peer="CN=CloudFlare Origin Certificate,..."
EDGE_TLS_OK[1] 198.41.192.57:7844 ...
EDGE_TLS_OK[2] 198.41.200.63:7844 ...
EDGE_TLS_OK[3] 198.41.192.7:7844  ...
RESULT: EDGE_TLS_OK count=4
```

## 待办：账号侧开通（需阿庆操作/授权）

1. Cloudflare 账号添加站点 cyqing.icu（免费套餐），拿到 2 个 NS。
2. 阿里云把 cyqing.icu 的 NS 改为 Cloudflare 的 NS。
   （NS 生效前现有 Serveo 站照常；隧道先建好再切 NS，无停机窗口。）
3. 给我一个 Cloudflare API 令牌（权限：Account·Cloudflare Tunnel·Edit、
   Zone·DNS·Edit、Zone·Zone·Read），走安全录入，不要发聊天里。
   之后我全权完成：建命名隧道 → 写 DNS 路由 → 下发凭据（存
   ~/.cloudflared/，0600）→ 启动 cf-tunnel-start.sh → 把巡检从
   Serveo 切到 Cloudflare → 公网 HTTPS/API/WebSocket/断线恢复测试 →
   停掉 Serveo。

## 架构（开通后）

```
浏览器 → HTTPS → Cloudflare 边缘 → Tunnel (http2/TCP 7844)
  → [本机补丁] HTTP CONNECT 代理 → cloudflared-proxy
  → 127.0.0.1:7860 门户（/ 门户、/files 文件站、/douyin 随手存）
```
自动恢复（三级，均已实测）：① 连接级——cloudflared 进程内重试/退避
（4 条 HA 连接，单条被出口代理掐断时约 10 秒自愈）；② 进程级——
systemd 单元 cloudflared-proxy 托管（Restart=always、RestartSec=5、
enabled 开机自启；2026-10-22 kill -9 实测 35 秒内公网恢复 200）；
③ 巡检级——watchdog 每 2 分钟查进程与公网 200 作最后兜底。
单元源文件在本目录 cloudflared-proxy.service，安装于
/etc/systemd/system/；单元经 EnvironmentFile 引用平台维护的
/etc/environment.d/80-hatch-egress.conf 取无认证代理变量（实测无认证
CONNECT 可用），不落盘任何凭据。cf-tunnel-start.sh 已改为 systemd
优先：单元缺失/过期时自动重装（模拟删除实测通过），systemd 不可用
才回落 nohup。背景：2026-10-21 夜出口代理多次同时掐断 4 条连接，
全断时进程退出、裸跑靠巡检拉起出现过 10 次 1~5 分钟断窗，加托管
后断窗压到秒级。
安全：源站只监听 127.0.0.1，无公网裸露端口；各子应用自有登录不变；
隧道凭据仅存 ~/.cloudflared（0600），不进聊天/记忆。
