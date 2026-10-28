import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MapPin, Plus, Search, ChevronLeft } from 'lucide-react';
import { api, imageUrl } from '../api';
import { useSession } from '../main';
import { TripCard, Detail } from './Public';

export default function Travel() {
  const { authenticated } = useSession();
  const [params, setParams] = useSearchParams(), cityId = params.get('city') || '';
  const [cities, setCities] = useState([]), [items, setItems] = useState([]);
  const [q, setQ] = useState(''), [status, setStatus] = useState(''), [sort, setSort] = useState('date');
  const [selected, setSelected] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setLoading(true); setSelected(null); setError('');
    const query = new URLSearchParams(Object.entries({ q, status, sort, cityId }).filter(([, value]) => value));
    Promise.all([api('/cities'), api('/records/travel?' + query)]).then(([c, r]) => {
      if (active) { setCities(c.items); setItems(r.items); }
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cityId, q, status, sort, authenticated]);
  const city = cities.find(c => c.id === cityId);
  return <main className="page-wrap travel-cities-page">
    <div className="page-heading"><div><p className="eyebrow">ONE CITY, MANY LITTLE STORIES</p><h1>{city ? city.name + '的风景' : '旅行足迹'}</h1><p>一座城，一些风景。把想去和去过的地方慢慢收藏。</p></div>{authenticated && <Link className="primary" to={'/admin/travel' + (cityId ? '?city=' + encodeURIComponent(cityId) : '')}><Plus size={16} />{city ? '管理这里的景点' : '管理城市与景点'}</Link>}</div>
    {cityId && <button className="back-button" onClick={() => setParams({})}><ChevronLeft size={17} /> 全部城市</button>}
    {!cityId && <section aria-label="城市分类"><div className="city-intro"><span><MapPin size={18} /> 按城市收藏风景</span><small>{cities.length} 座城市</small></div><div className="city-grid public-city-grid">{cities.map(c => <button className="city-card" key={c.id} onClick={() => setParams({ city: c.id })} aria-label={'查看城市' + c.name}>
      {c.coverId && <img src={imageUrl(c.coverId)} alt="" />}<span className="city-card-shade" /><span className="city-card-copy"><small>CITY COLLECTION</small><strong>{c.name}</strong><span>{c.count} 个景点 · {c.visited} 个已去</span><b>看看这座城 →</b></span>
    </button>)}</div></section>}
    <div className="section-title"><div><span>PLACES & MEMORIES</span><h2>{city ? city.name + '的景点' : '风景收藏夹'}<i>✦</i></h2></div><small>{items.length} 个景点</small></div>
    <div className="filter-bar"><label className="filter-search"><Search size={17} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索城市、景点或心得" /></label><select aria-label="旅行状态" value={status} onChange={e => setStatus(e.target.value)}><option value="">全部状态</option><option>已去</option><option>想去</option></select><select aria-label="排序" value={sort} onChange={e => setSort(e.target.value)}><option value="date">按日期</option><option value="newest">最近更新</option><option value="oldest">最早记录</option></select></div>
    {error && <p className="alert" role="alert">{error}</p>}
    {loading ? <p className="muted" role="status">正在翻开旅行手帐…</p> : <div className="trip-grid">{items.map(item => <TripCard key={item.id} item={item} onClick={setSelected} />)}</div>}
    {!loading && !error && !items.length && <div className="empty"><span>✦</span><h3>还没有可展示的景点</h3><p>{q || status ? '换个关键词或状态试试。' : '下一处风景，正在路上。'}</p></div>}
    {selected && <Detail item={selected} close={() => setSelected(null)} />}
  </main>;
}
