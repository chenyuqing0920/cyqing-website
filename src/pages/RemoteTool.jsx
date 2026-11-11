import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useSession } from '../main';

// 远程桌面：家里 Windows agent，经前置代理 /life/rd/（BASE_URL 感知）。
// 反代层先验本站登录态，未登录直接 401；页面本身也只在已登录时嵌 iframe。
const RD = import.meta.env.BASE_URL + 'rd/';

export default function RemoteTool() {
  const { authenticated, loading } = useSession();
  return (
    <main className="page-wrap tool-page">
      <div className="tool-back"><Link to="/tools"><ArrowLeft size={15} /> 返回工具箱</Link></div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">REMOTE DESKTOP</p>
          <h1>远程桌面</h1>
          <p>家里电脑的桌面，直接在浏览器里打开。</p>
        </div>
      </div>
      {loading ? (
        <p className="muted">正在确认登录状态…</p>
      ) : !authenticated ? (
        <div className="login-hint">
          <p>登录后才能打开远程桌面。</p>
          <Link to="/admin">进入管理后台 →</Link>
        </div>
      ) : (
        <>
          <p className="muted">点击画面后键盘才会转发到远端。画面卡顿或断开时，刷新本页即可重连。</p>
          <iframe
            src={RD}
            title="远程桌面"
            allow="fullscreen; clipboard-read; clipboard-write"
            style={{ width: '100%', height: 'calc(100vh - 80px)', border: '1px solid #dfe5ee', borderRadius: 12 }}
          />
          <p className="muted" style={{ marginTop: 12 }}>
            <a href={RD} target="_blank" rel="noopener noreferrer">在新窗口打开 →</a>
          </p>
        </>
      )}
    </main>
  );
}
