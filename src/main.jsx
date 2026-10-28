import React, { useEffect, useState, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, Sparkles, Compass, Tv, NotebookPen, Wrench, LockKeyhole, Plus, LogOut, Home as HomeIcon, Settings, Search, Image, CalendarDays, Heart, ChevronDown } from 'lucide-react';
import { api,setCsrf } from './api';
import { Home, Anime, Notes, Tools } from './pages/Public';
import Admin from './pages/Admin';
import Travel from './pages/Travel';
import DouyinTool from './pages/DouyinTool';
import FilesTool from './pages/FilesTool';
import './style.css';

export const SessionContext=createContext(null);
export const useSession=()=>useContext(SessionContext);
function Shell(){
  const [session,setSession]=useState({loading:true,authenticated:false}),[menu,setMenu]=useState(false),[quick,setQuick]=useState(false),[message,setMessage]=useState(''),[scrolled,setScrolled]=useState(false);
  const location=useLocation(),navigate=useNavigate();
  const refresh=async()=>{try{const s=await api('/auth/session');setCsrf(s.csrf);setSession({...s,loading:false});}catch{setSession({authenticated:false,loading:false});}};
  useEffect(()=>{refresh();},[]);useEffect(()=>{setMenu(false);window.scrollTo(0,0);},[location.pathname]);
  useEffect(()=>{const track=()=>setScrolled(window.scrollY>20);track();window.addEventListener('scroll',track,{passive:true});return()=>window.removeEventListener('scroll',track);},[]);
  const toast=text=>{setMessage(text);setTimeout(()=>setMessage(''),4500);};
  const logout=async()=>{try{await api('/auth/logout',{method:'POST'});setCsrf('');setSession({authenticated:false,loading:false});navigate('/');toast('已退出登录');}catch(e){toast(e.message);}};
  const routes=[['/','首页',HomeIcon],['/travel','旅行',Compass],['/anime','追番',Tv],['/notes','手帐',NotebookPen],['/tools','工具箱',Wrench]];
  return <SessionContext.Provider value={{...session,refresh,toast,logout}}><div className={'app-shell '+(location.pathname==='/'?'shell-home':location.pathname.startsWith('/admin')?'shell-admin':'shell-interior')}>
    {location.pathname!=='/'&&<div className={'page-atmosphere'+(location.pathname.startsWith('/admin')?' is-admin':'')} aria-hidden="true" style={{backgroundImage:`linear-gradient(90deg,#101a31b8,#14223a55),url("${import.meta.env.BASE_URL}water02.jpg")`}}><div className="atm-hero-overlay"/><div className="particles">{Array.from({length:location.pathname.startsWith('/admin')?12:22},(_,i)=><i key={i} style={{'--i':i}}/>)}</div></div>}
    <header className={'top-nav '+(location.pathname==='/'?'over-hero':'interior')+(scrolled?' scrolled':'')}><NavLink className="brand" to="/"><span className="brand-mark">✦</span><span>星光手帐<small>MY LITTLE UNIVERSE</small></span></NavLink><nav className={menu?'nav-links open':'nav-links'} aria-label="主导航">{routes.map(([href,label,Icon])=><NavLink key={href} to={href} end={href==='/'}><Icon size={15}/>{label}</NavLink>)}<NavLink to="/admin"><LockKeyhole size={15}/>{session.authenticated?'管理':'登录'}</NavLink></nav><div className="nav-actions">{session.authenticated&&<button className="quick-nav" onClick={()=>setQuick(true)}><Plus size={15}/> 快速记录</button>}<button className="menu-toggle" aria-label={menu?'关闭菜单':'打开菜单'} onClick={()=>setMenu(!menu)}>{menu?<X/>:<Menu/>}</button></div></header>
    <Routes><Route path="/" element={<Home/>}/><Route path="/travel" element={<Travel/>}/><Route path="/anime" element={<Anime/>}/><Route path="/notes" element={<Notes/>}/><Route path="/tools" element={<Tools/>}/><Route path="/tools/douyin" element={<DouyinTool/>}/><Route path="/tools/files" element={<FilesTool/>}/><Route path="/admin/*" element={<Admin/>}/><Route path="*" element={<div className="page-wrap"><h1>这个地方还没有故事。</h1><NavLink to="/">返回首页</NavLink></div>}/></Routes>
    <footer className="site-footer"><div className="footer-mark">✦</div><p>把平凡的日子，过成喜欢的样子。</p><small>© {new Date().getFullYear()} 星光里的生活手帐 · Made for moments</small></footer>
    {session.authenticated&&<button className="quick-float" onClick={()=>setQuick(true)} aria-label="快速记录"><Plus size={21}/></button>}
    {quick&&<QuickNote close={()=>setQuick(false)}/>}{message&&<div role="status" className="toast">{message}</div>}
  </div></SessionContext.Provider>;
}
function QuickNote({close}){const [title,setTitle]=useState(''),[content,setContent]=useState(''),[busy,setBusy]=useState(false);const {toast}=useSession();async function save(e){e.preventDefault();setBusy(true);try{await api('/records/note',{method:'POST',body:{title,content,tags:[],isPublic:false,isDraft:false}});toast('已保存为私密记录');close();}catch(e){toast(e.message);}finally{setBusy(false);}}return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><section role="dialog" aria-modal="true" aria-labelledby="quick-title" className="modal"><button className="close-modal" onClick={close} aria-label="关闭"><X size={20}/></button><p className="eyebrow">A LITTLE THOUGHT</p><h2 id="quick-title">记下这一刻</h2><p className="muted">灵感稍纵即逝，先把它收起来。默认仅自己可见。</p><form onSubmit={save}><label>标题<input value={title} onChange={e=>setTitle(e.target.value)} required maxLength={120}/></label><label>想法<textarea value={content} onChange={e=>setContent(e.target.value)} rows="6" placeholder="此刻在想什么？"/></label><button className="primary" disabled={busy}>{busy?'保存中…':'保存记录'}</button></form></section></div>;}

createRoot(document.getElementById('root')).render(<HashRouter><Shell/></HashRouter>);
