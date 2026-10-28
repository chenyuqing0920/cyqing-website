import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, MapPin, ChevronLeft, Edit, Trash2, Upload, Save, Search } from 'lucide-react';
import { api, imageUrl, uploadImage, cleanDate, splitTags } from '../api';
import { useSession } from '../main';

export default function TravelManager() {
  const { toast } = useSession();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('city') || '';
  const [cities, setCities] = useState([]), [items, setItems] = useState([]);
  const [q, setQ] = useState(''), [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null), [cityForm, setCityForm] = useState(null);
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [savingCity, setSavingCity] = useState(false);
  const city = cities.find(c => c.id === selectedId);
  const reload = () => setRevision(n => n + 1);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const query = new URLSearchParams(Object.entries({ q, status, sort: 'date', cityId: selectedId }).filter(([, value]) => value));
    Promise.all([api('/cities'), api('/records/travel?' + query)])
      .then(([c, r]) => { if (active) { setCities(c.items); setItems(r.items); } })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedId, q, status, revision]);
  useEffect(() => { setEditing(null); setQ(''); setStatus(''); }, [selectedId]);
  const choose = id => { setParams(id ? { city: id } : {}); setCityForm(null); };
  async function saveCity(e) {
    e.preventDefault(); setSavingCity(true);
    try {
      const saved = await api('/cities' + (cityForm.id ? '/' + cityForm.id : ''), {
        method: cityForm.id ? 'PUT' : 'POST', body: { name: cityForm.name }
      });
      setCityForm(null); choose(saved.id); reload(); toast('城市已保存，可以添加景点了');
    } catch (e) { toast(e.message); } finally { setSavingCity(false); }
  }
  async function deleteCity() {
    if (!confirm(`删除空城市「${city.name}」？有景点的城市不能删除。`)) return;
    try { await api('/cities/' + city.id, { method: 'DELETE' }); choose(''); reload(); toast('城市已删除'); }
    catch (e) { toast(e.message); }
  }
  async function remove(item) {
    if (!confirm(`删除景点「${item.title}」？照片仍保留在图片管理中。`)) return;
    try { await api('/records/travel/' + item.id, { method: 'DELETE' }); reload(); toast('景点已删除'); }
    catch (e) { toast(e.message); }
  }
  return <>
    <div className="admin-heading flex-heading"><div><p className="eyebrow">CITIES & LITTLE ADVENTURES</p>
      <h1>旅行管理</h1><p>先收藏一座城市，再慢慢记录其中的风景。</p></div>
      <button className="primary" onClick={() => setCityForm({ name: '' })}><Plus size={17} /> 新建城市</button>
    </div>
    {cityForm && <form className="editor-card city-form" onSubmit={saveCity}>
      <label>{cityForm.id ? '修改城市名称' : '城市名称'}<input autoFocus required maxLength={80} placeholder="例如：南京" value={cityForm.name} onChange={e => setCityForm({ ...cityForm, name: e.target.value })} /></label>
      <div className="editor-actions"><button className="primary" disabled={savingCity}>{savingCity ? '保存中…' : '保存城市'}</button><button type="button" className="secondary" onClick={() => setCityForm(null)}>取消</button></div>
    </form>}
    {error && <p className="alert" role="alert">{error}</p>}
    {selectedId ? <>
      <button className="back-button" onClick={() => choose('')}><ChevronLeft size={17} /> 全部城市</button>
      {city && <section className="city-detail-heading"><div><p className="eyebrow">CITY COLLECTION</p><h2><MapPin size={24} /> {city.name}</h2><p>{city.count} 个景点 · {city.visited} 个已去 · {city.count - city.visited} 个想去</p></div>
        <div className="city-actions"><button className="secondary" onClick={() => setCityForm({ id: city.id, name: city.name })}>修改城市</button><button className="secondary" onClick={deleteCity}>删除空城市</button><button className="primary" onClick={() => setEditing({ key: Date.now() })}><Plus size={16} /> 添加景点</button></div>
      </section>}
      {!city && !loading && !error && <div className="empty">这个城市不存在，请返回全部城市。</div>}
      {editing && city ? <SpotEditor key={editing.id || editing.key} item={editing.id ? editing : null} city={city} cities={cities}
        close={() => setEditing(null)} saved={more => { reload(); setEditing(more ? { key: Date.now() } : null); }} /> : <>
        <div className="admin-filters"><label className="spot-search"><Search size={17} /><input aria-label="搜索景点" placeholder="搜索景点名或心得" value={q} onChange={e => setQ(e.target.value)} /></label><select aria-label="景点状态" value={status} onChange={e => setStatus(e.target.value)}><option value="">全部状态</option><option>已去</option><option>想去</option></select></div>
        {loading ? <p className="muted" role="status">正在加载景点…</p> : <div className="managed-spot-grid">{items.map(item => <article className="managed-spot" key={item.id}>
          <div className="managed-spot-cover">{item.photos?.[0] ? <img src={imageUrl(item.photos[0].assetId)} alt={item.title} /> : <MapPin size={34} />}<span className="badge">{item.status}</span></div>
          <div className="managed-spot-body"><h3>{item.title}</h3><p>{cleanDate(item.date) || '日期待定'} · {item.isPublic ? '公开' : '私密'} · {item.photos.length} 张照片</p>
            <div className="row-actions"><button aria-label={'编辑' + item.title} onClick={() => setEditing(item)}><Edit size={15} /> 编辑</button><button className="danger-text" aria-label={'删除' + item.title} onClick={() => remove(item)}><Trash2 size={15} /> 删除</button></div></div>
        </article>)}</div>}
        {!loading && !items.length && city && !error && <div className="empty"><span>✦</span><h3>{q || status ? '没有符合条件的景点' : '写下' + city.name + '的第一处风景'}</h3><p>景点名称和照片，就能开启一段记录。</p><button className="primary" onClick={() => setEditing({ key: Date.now() })}>添加景点</button></div>}
      </>}
    </> : <>
      <div className="city-intro"><span><MapPin size={18} /> 我的城市收藏</span><small>{cities.length} 座城市 · 点击城市添加和管理景点</small></div>
      {loading ? <p className="muted">正在加载城市…</p> : <div className="city-grid">{cities.map(c => <button className="city-card" key={c.id} onClick={() => choose(c.id)} aria-label={'管理城市' + c.name}>
        {c.coverId && <img src={imageUrl(c.coverId)} alt="" />}<span className="city-card-shade" /><span className="city-card-copy"><small>CITY COLLECTION</small><strong>{c.name}</strong><span>{c.count} 个景点 · {c.visited} 个已去</span><b>进入城市 →</b></span>
      </button>)}<button className="city-card new-city" onClick={() => setCityForm({ name: '' })}><Plus size={30} /><strong>添加一座城市</strong><span>先建南京，再收藏南京的景点</span></button></div>}
    </>}
  </>;
}

function SpotEditor({ item, city, cities, close, saved }) {
  const { toast } = useSession();
  const [form, setForm] = useState(() => item ? { ...item, date: cleanDate(item.date), tags: item.tags.join(', '), photoIds: item.photos.map(p => p.assetId) } :
    { title: '', cityId: city.id, date: '', status: '想去', story: '', tags: '', isPublic: false, photoIds: [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const update = (key, value) => setForm(f => ({ ...f, [key]: value }));
  async function upload(e) {
    const input = e.target, files = Array.from(input.files || []);
    if (!files.length) return;
    if (files.length + form.photoIds.length > 30) { setError('每个景点最多上传 30 张照片'); input.value = ''; return; }
    setBusy(true); setError(''); let count = 0; const failed = [];
    for (const file of files) {
      try { const asset = await uploadImage(file); setForm(f => ({ ...f, photoIds: [...f.photoIds, asset.id] })); count++; }
      catch (e) { failed.push(file.name + '：' + e.message); }
    }
    input.value = ''; setBusy(false);
    if (failed.length) setError(`已上传 ${count}/${files.length} 张。${failed.join('；')}。可重新选择失败的图片重试。`);
    else toast(`已上传 ${count} 张照片`);
  }
  async function save(e) {
    e.preventDefault(); const more = e.nativeEvent.submitter?.value === 'more';
    setBusy(true); setError('');
    try {
      const body = { title: form.title, cityId: form.cityId, date: form.date, status: form.status, story: form.story,
        tags: splitTags(form.tags), isPublic: form.isPublic, photoIds: form.photoIds };
      await api('/records/travel' + (item ? '/' + item.id : ''), { method: item ? 'PUT' : 'POST', body });
      toast('景点已保存'); saved(more);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="editor-card spot-editor"><button className="back-button" onClick={close} disabled={busy}><ChevronLeft size={17} /> 返回{city.name}</button>
    <h2>{item ? '编辑景点' : '在' + city.name + '添加景点'}</h2><p className="muted">新景点默认私密。先记下名字，照片和心得可以慢慢补充。</p>
    <form onSubmit={save}><fieldset disabled={busy} className="editor-fields">
      <label className="form-field">景点名称<input autoFocus required maxLength={120} placeholder="例如：夫子庙、玄武湖、中山陵" value={form.title} onChange={e => update('title', e.target.value)} /></label>
      {item && <label className="form-field">所属城市<select value={form.cityId} onChange={e => update('cityId', e.target.value)}>{cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      <div className="image-picker"><span>景点照片</span><div className="selected-images">{form.photoIds.map((id, i) => <div key={id}><img src={imageUrl(id)} alt={'景点照片 ' + (i + 1)} /><button type="button" onClick={() => update('photoIds', form.photoIds.filter(x => x !== id))} aria-label={'移除第' + (i + 1) + '张照片'}>×</button></div>)}
        <label className="upload-box"><Upload size={20} /><span>{busy ? '处理中…' : '添加照片'}</span><input aria-label="上传景点照片" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={upload} /></label></div><small>每个景点最多 30 张；单张不超过 10 MB，支持 JPG、PNG、WebP 和 GIF。</small></div>
      <div className="form-grid two"><label className="form-field">日期<input type="date" value={form.date} onChange={e => update('date', e.target.value)} /></label><label className="form-field">状态<select value={form.status} onChange={e => update('status', e.target.value)}><option>想去</option><option>已去</option></select></label></div>
      <label className="form-field">景点心得<textarea rows={4} value={form.story} onChange={e => update('story', e.target.value)} placeholder="这里有什么值得记住的？" /></label>
      <label className="form-field">标签<input value={form.tags} onChange={e => update('tags', e.target.value)} placeholder="例如：古迹, 散步, 美食" /></label>
      <label className="checkbox"><input type="checkbox" checked={form.isPublic} onChange={e => update('isPublic', e.target.checked)} />公开这个景点（包含照片和心得）</label>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="editor-actions"><button className="primary" type="submit" value="save"><Save size={16} />{busy ? '处理中…' : '保存景点'}</button>{!item && <button className="secondary" type="submit" value="more">保存并继续添加</button>}<button type="button" className="secondary" onClick={close}>取消</button></div>
    </fieldset></form>
  </section>;
}
