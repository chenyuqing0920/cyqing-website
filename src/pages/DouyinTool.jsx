import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download, Film, Image as ImageIcon, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { useSession } from '../main';

// Same-origin via the main site (BASE_PATH aware): /life/douyin in production.
const PREFIX = import.meta.env.BASE_URL + 'douyin';
const STATES = { queued: '排队中', resolving: '解析中', ready: '可下载', failed: '未完成', cancelled: '已取消' };

async function douyinApi(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
  };
  const response = await fetch(PREFIX + path, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

function videoURL(job, inline = false) {
  return `${PREFIX}/files/${encodeURIComponent(job.id)}/relay${inline ? '?inline=1' : ''}`;
}
function imageURL(job, number, inline = false) {
  return `${PREFIX}/files/${encodeURIComponent(job.id)}/images/${number}${inline ? '?inline=1' : ''}`;
}

export default function DouyinTool() {
  const { toast } = useSession();
  const [ready, setReady] = useState(false);
  const [text, setText] = useState('');
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState('connecting');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await douyinApi('/api/jobs');
      setJobs(data.jobs || []);
      setOnline('online');
      setError('');
    } catch (e) {
      setOnline('error');
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await douyinApi('/api/session');
        if (cancelled) return;
        setReady(true);
        setOnline('online');
        await refresh();
      } catch (e) {
        if (!cancelled) {
          setOnline('error');
          setError(e.message.includes('Failed to fetch')
            ? '随手存服务未启动。请在 douyin 目录运行：python linux_server.py --port 7863'
            : e.message);
        }
      }
    })();
    return () => { cancelled = true; clearTimeout(timer.current); };
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!ready) return undefined;
    timer.current = setTimeout(() => refresh(), 2500);
    return () => clearTimeout(timer.current);
  }, [ready, jobs, refresh]);

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await douyinApi('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setText('');
      toast?.('正在解析，完成后可预览或下载');
      await refresh();
    } catch (err) {
      toast?.(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(path, message) {
    try {
      await douyinApi(path, {
        method: 'POST',
        body: '{}',
      });
      if (message) toast?.(message);
      await refresh();
    } catch (err) {
      toast?.(err.message);
    }
  }

  async function retryLink(link) {
    try {
      await douyinApi('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ text: link }),
      });
      await refresh();
    } catch (err) {
      toast?.(err.message);
    }
  }

  function downloadJob(job) {
    const a = document.createElement('a');
    a.href = videoURL(job);
    a.download = '';
    document.body.append(a);
    a.click();
    a.remove();
    toast?.(job.cached ? '已开始本地下载' : '已开始中转下载');
  }

  async function downloadZip(job) {
    try {
      const response = await fetch(`${PREFIX}/files/${job.id}/images.zip`, { credentials: 'same-origin' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '打包失败');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(job.title || '图文').replace(/[<>:"/\\|?*]/g, '_').slice(0, 60)}_${job.image_count}张.zip`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast?.(`已生成 ZIP，共 ${job.image_count} 张`);
    } catch (err) {
      toast?.(err.message);
      refresh();
    }
  }

  return (
    <main className="page-wrap tool-page">
      <div className="tool-back"><Link to="/tools"><ArrowLeft size={15} /> 返回工具箱</Link></div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SAVE AS YOU GO</p>
          <h1>随手存</h1>
          <p>粘贴分享链接，解析、预览和保存，一处完成。免访问密码。</p>
        </div>
        <div className="heading-icon"><Film size={28} /></div>
      </div>

      <div className={'connection-chip ' + online}>
        {online === 'online' ? '服务已连接' : online === 'connecting' ? '正在连接…' : '服务未连接'}
        <button type="button" className="quiet-icon" onClick={() => refresh()} aria-label="刷新"><RefreshCw size={14} /></button>
      </div>
      {error && <p className="alert">{error}</p>}

      <section className="tool-panel douyin-submit">
        <form onSubmit={submit}>
          <label>
            分享文案或链接
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="粘贴抖音分享文案或视频链接，一次最多 20 条"
              required
            />
          </label>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setText('')}>清空</button>
            <button className="primary" disabled={busy || online !== 'online'}>
              {busy ? <><Loader2 size={15} className="spin" /> 提交中…</> : '开始解析'}
            </button>
          </div>
        </form>
      </section>

      <section className="tool-panel">
        <div className="tool-title">
          <span>↓</span>
          <div><h2>解析记录</h2><p>共 {jobs.length} 条 · 完成后可预览或下载</p></div>
        </div>
        {!jobs.length && <div className="empty"><span>✦</span><h3>还没有解析记录</h3><p>粘贴链接，开始保存第一条作品。</p></div>}
        <div className="job-list">
          {jobs.map((job) => (
            <article key={job.id} className={'job-card state-' + job.state}>
              <div className="job-top">
                <div>
                  <h3>{job.title || '视频'}</h3>
                  <p className="muted">{job.message || ''}</p>
                </div>
                <span className="job-status">{STATES[job.state] || job.state}</span>
              </div>
              {job.state === 'ready' && job.type !== 'gallery' && (
                <video className="job-video" controls playsInline preload="none" src={videoURL(job, true)} />
              )}
              {job.state === 'ready' && job.type === 'gallery' && (
                <div className="gallery-block">
                  <p className="muted">图文 · {job.image_count} 张 · 已保存 {(job.images || []).filter((i) => i.state === 'ready').length}/{job.image_count}</p>
                  <div className="gallery-grid">
                    {(job.images || []).map((image) => (
                      <figure key={image.index} className="gallery-tile">
                        {image.state === 'ready'
                          ? <a href={imageURL(job, image.index, true)} target="_blank" rel="noreferrer"><img src={imageURL(job, image.index, true)} alt={`第 ${image.index} 张`} loading="lazy" /></a>
                          : <div className="gallery-placeholder">{image.state === 'failed' ? '失败' : '等待'}</div>}
                        <figcaption>#{image.index}</figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              )}
              <div className="job-actions">
                {job.state === 'ready' && job.type !== 'gallery' && (
                  <>
                    <button type="button" className="secondary" onClick={() => setPreview(job)}>预览</button>
                    <button type="button" className="primary" onClick={() => downloadJob(job)}><Download size={14} /> 下载</button>
                  </>
                )}
                {job.state === 'ready' && job.type === 'gallery' && (
                  <>
                    <button type="button" className="primary" onClick={() => downloadZip(job)} disabled={(job.images || []).some((i) => i.state !== 'ready')}>
                      <ImageIcon size={14} /> 下载 ZIP
                    </button>
                    {(job.images || []).some((i) => i.state !== 'ready') && (
                      <button type="button" className="secondary" disabled={job.preparing} onClick={() => act(`/api/jobs/${job.id}/images/prepare`, '正在准备图片')}>重试未完成</button>
                    )}
                  </>
                )}
                {['queued', 'resolving'].includes(job.state) && (
                  <button type="button" className="secondary" onClick={() => act(`/api/jobs/${job.id}/cancel`)}>取消</button>
                )}
                {job.state === 'failed' && (
                  <button type="button" className="secondary" onClick={() => retryLink(job.link)}>重试</button>
                )}
                {!['queued', 'resolving'].includes(job.state) && (
                  <button type="button" className="quiet-icon" aria-label="删除" onClick={() => { if (confirm('确定删除这条记录？服务器副本也会删除。')) act(`/api/jobs/${job.id}/delete`, '已删除'); }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {preview && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPreview(null)}>
          <section className="modal" role="dialog" aria-modal="true">
            <button className="close-modal" onClick={() => setPreview(null)} aria-label="关闭"><X size={20} /></button>
            <h2>{preview.title || '视频预览'}</h2>
            <video className="preview-video" controls autoPlay playsInline src={videoURL(preview, true)} />
          </section>
        </div>
      )}
    </main>
  );
}
