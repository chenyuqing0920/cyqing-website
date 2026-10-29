import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FolderUp, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useSession } from '../main';

// Same-origin via the main site (BASE_PATH aware): /life/files in production.
const FILES = import.meta.env.BASE_URL + 'files';

async function filesApi(path, options = {}) {
  const response = await fetch(FILES + path, {
    method: options.method || 'GET',
    body: options.body,
    headers: options.headers,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json().catch(() => ({})) : {};
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

export default function FilesTool() {
  const { toast } = useSession();
  const [files, setFiles] = useState([]);
  const [online, setOnline] = useState('connecting');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await filesApi('/api/list');
      setFiles(data.files || []);
      setOnline('online');
      setError('');
    } catch (e) {
      setOnline('error');
      setError(e.message.includes('Failed to fetch')
        ? '文件小站未启动。请在 backend/file-drop 运行：python app.py'
        : e.message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function onPick(list) {
    setSelected(Array.from(list || []));
  }

  function upload() {
    if (!selected.length || uploading) return;
    setUploading(true);
    setProgress(0);
    setError('');
    const data = new FormData();
    selected.forEach((file) => data.append('files', file, file.name));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', FILES + '/api/upload');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText);
          setFiles(body.files || []);
        } catch {
          refresh();
        }
        setSelected([]);
        if (inputRef.current) inputRef.current.value = '';
        setProgress(100);
        toast?.('上传完成');
      } else {
        let message = '上传失败';
        try { message = JSON.parse(xhr.responseText).error || message; } catch {}
        setError(message);
        toast?.(message);
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      setError('网络中断，请重试');
      toast?.('网络中断，请重试');
    };
    xhr.send(data);
  }

  async function remove(name) {
    if (!confirm(`确定删除「${name}」？删除后无法恢复。`)) return;
    try {
      const data = await filesApi('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setFiles(data.files || []);
      toast?.('已删除');
    } catch (e) {
      toast?.(e.message);
    }
  }

  const selectedSize = selected.reduce((n, f) => n + f.size, 0);
  function human(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
    return `${(n / 1073741824).toFixed(1)} GB`;
  }

  return (
    <main className="page-wrap tool-page">
      <div className="tool-back"><Link to="/tools"><ArrowLeft size={15} /> 返回工具箱</Link></div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PASS IT ALONG</p>
          <h1>文件小站</h1>
          <p>在手机和电脑之间轻松传文件。免访问密码，同站直接用。</p>
        </div>
        <div className="heading-icon"><FolderUp size={28} /></div>
      </div>

      <div className={'connection-chip ' + online}>
        {online === 'online' ? '服务已连接' : online === 'connecting' ? '正在连接…' : '服务未连接'}
        <button type="button" className="quiet-icon" onClick={refresh} aria-label="刷新"><RefreshCw size={14} /></button>
      </div>
      {error && <p className="alert">{error}</p>}

      <div className="files-layout">
        <section className="tool-panel">
          <div className="tool-title">
            <span>↑</span>
            <div><h2>上传文件</h2><p>支持一次选择多个文件</p></div>
          </div>
          <label
            className={'dropzone' + (dragging ? ' dragging' : '')}
            onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!uploading && e.dataTransfer.files?.length) onPick(e.dataTransfer.files);
            }}
          >
            <Upload size={28} />
            <strong>点击选择文件，或拖到这里</strong>
            <small>文件保存在服务器，换设备也能下载</small>
            <input
              ref={inputRef}
              type="file"
              multiple
              disabled={uploading || online !== 'online'}
              onChange={(e) => onPick(e.target.files)}
            />
          </label>
          {!!selected.length && (
            <ul className="selected-list">
              {selected.map((file) => <li key={file.name + file.size}>{file.name}</li>)}
            </ul>
          )}
          <div className="form-actions files-actions">
            <span className="muted">{selected.length ? `已选 ${selected.length} 个 · ${human(selectedSize)}` : '还没有选择文件'}</span>
            <button className="primary" disabled={!selected.length || uploading || online !== 'online'} onClick={upload}>
              {uploading ? <><Loader2 size={15} className="spin" /> 上传中 {progress}%</> : '开始上传'}
            </button>
          </div>
          {uploading && <progress className="upload-progress" max={100} value={progress} />}
        </section>

        <aside className="tool-panel storage-note">
          <h3>一处暂存，两端接力</h3>
          <p>文件保存在站点服务器上，不是当前浏览器里。换台设备打开同一页面就能下载。</p>
        </aside>
      </div>

      <section className="tool-panel">
        <div className="tool-title">
          <span>▤</span>
          <div><h2>已存文件</h2><p>最近上传的排在前面 · 共 {files.length} 个</p></div>
        </div>
        {!files.length && <div className="empty"><span>✦</span><h3>还没有文件</h3><p>先传一个文档、图片，或准备换设备接着用的东西。</p></div>}
        <div className="file-rows">
          {files.map((file) => (
            <article key={file.name} className="file-row">
              <div className="file-name"><b>{file.name}</b><small>{file.size} · {file.time}</small></div>
              <div className="file-actions">
                <a className="secondary" href={`${FILES}/download/${encodeURIComponent(file.name)}`} download>下载</a>
                <button type="button" className="quiet-icon" aria-label={`删除 ${file.name}`} onClick={() => remove(file.name)}><Trash2 size={14} /></button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
