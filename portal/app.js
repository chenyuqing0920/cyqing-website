'use strict';
const $ = selector => document.querySelector(selector);
const {prompts: PROMPTS, sites: SITES} = window.CYQING_CONTENT;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
const today = () => new Date().toLocaleDateString('sv-SE');
const blockedStorage = new Set();
let noticeTimer;
function notify(message, error=false) {
  $('#notice').textContent=message;
  $('#notice').classList.toggle('error',error);
  $('#notice').hidden=false;
  clearTimeout(noticeTimer);
  noticeTimer=setTimeout(()=>$('#notice').hidden=true,error?8500:3500);
}
function normalizePrompt(p) {
  if(!p || typeof p!=='object' || typeof p.title!=='string' || !p.title.trim() || typeof p.text!=='string' || !p.text.trim()) throw Error('提示词必须包含标题和正文');
  return {id:typeof p.id==='string'&&p.id?p.id:uid(),title:p.title,cat:typeof p.cat==='string'&&p.cat.trim()?p.cat:'未分类',desc:typeof p.desc==='string'?p.desc:'',text:p.text,src:typeof p.src==='string'?p.src:''};
}
function normalizeWatch(w) {
  if(!w || typeof w!=='object' || typeof w.title!=='string' || !w.title.trim()) throw Error('观影记录必须包含名称');
  return {id:typeof w.id==='string'&&w.id?w.id:uid(),title:w.title,type:['动漫','电影','电视剧','综艺','其他'].includes(w.type)?w.type:'其他',status:['想看','在看','已看'].includes(w.status)?w.status:'想看',score:Math.max(0,Math.min(5,Math.round(Number(w.score)||0))),note:typeof w.note==='string'?w.note:'',date:typeof w.date==='string'?w.date:today()};
}
function readRecords(key, normalize) {
  try {
    const raw=localStorage.getItem(key);
    if(raw===null)return [];
    const data=JSON.parse(raw);
    if(!Array.isArray(data))throw Error('记录格式错误');
    const records=data.map(normalize);
    blockedStorage.delete(key);
    return records;
  } catch {
    blockedStorage.add(key);
    setTimeout(()=>notify('本地记录暂时无法读取。原始内容已保留，请先导出备份；没有覆盖你的数据。',true),100);
    return [];
  }
}
function storeRecords(key, value) {
  if(blockedStorage.has(key))throw Error('此处已有无法读取的记录，请先导出原始备份并检查，暂未覆盖数据。');
  try {localStorage.setItem(key,JSON.stringify(value));}
  catch {throw Error('保存失败：浏览器存储空间不足或未允许本地存储，请先导出备份。');}
}
let myPrompts=readRecords('cyqing_my_prompts',normalizePrompt);
let watchList=readRecords('cyqing_watchlist',normalizeWatch);
let promptCategory='全部',watchStatus='全部',currentView='home';
const allPrompts=()=>PROMPTS.map(p=>({...p,mine:false})).concat(myPrompts.map(p=>({...p,mine:true})));
function downloadFile(filename, content, type='application/json') {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportRecords(key, records, filename) {
  try {
    const content=blockedStorage.has(key)?localStorage.getItem(key):JSON.stringify(records,null,2);
    downloadFile(filename,content??'[]');
    notify(blockedStorage.has(key)?'已导出原始记录，请保留这份备份。':'已导出，请在浏览器下载列表确认。');
  } catch {notify('浏览器不允许读取本地记录，暂时无法导出。',true);}
}
async function copyText(text, button) {
  try {
    if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(text);
    else {
      const area=document.createElement('textarea');area.value=text;area.style.cssText='position:fixed;left:-9999px';document.body.append(area);area.select();
      const copied=document.execCommand('copy');area.remove();if(!copied)throw Error('denied');
    }
    const original=button.textContent;button.textContent='已复制';setTimeout(()=>button.textContent=original,1800);
    notify('提示词已复制。');
  } catch {notify('复制未成功，请展开正文手动复制，或允许剪贴板访问。',true);}
}
function bookmark(site) {
  return `<a class="bookmark" href="${esc(site.url)}" target="_blank" rel="noopener noreferrer"><i aria-hidden="true">${esc(site.name[0])}</i><div><strong>${esc(site.name)}</strong><small>${esc(new URL(site.url).hostname)}</small></div><span aria-hidden="true">↗</span></a>`;
}
function renderHome() {
  $('#site-count').textContent=SITES.length;
  $('#prompt-count').textContent=allPrompts().length;
  $('#home-sites').innerHTML=SITES.slice(0,4).map(bookmark).join('');
  const homePrompts=allPrompts().slice(0,3);
  $('#home-prompt-list').innerHTML=homePrompts.map((p,i)=>`<div class="home-prompt-row">${icon('code')}<div><strong>${esc(p.title)}</strong><small>${esc(p.cat)}</small></div><button class="copy-btn" data-home-copy="${i}" aria-label="复制${esc(p.title)}">复制</button></div>`).join('');
  $('#home-watch-summary').textContent=watchList.length?`想看 ${watchList.filter(w=>w.status==='想看').length} 部，在看 ${watchList.filter(w=>w.status==='在看').length} 部，已看 ${watchList.filter(w=>w.status==='已看').length} 部。`:'观影清单还是空的，留给下一次心动。';
}
function renderSites() {
  const q=$('#site-search').value.trim().toLowerCase();
  const sites=SITES.filter(s=>(s.name+' '+s.desc).toLowerCase().includes(q));
  $('#site-summary').textContent=`${sites.length} 个网站`;
  $('#site-grid').innerHTML=sites.length?sites.map(s=>`<a class="site-card" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"><span class="site-icon" aria-hidden="true">${esc(s.name[0])}</span><h2>${esc(s.name)}</h2><p>${esc(s.desc)}</p><small>${esc(s.price)} · ${esc(new URL(s.url).hostname)}</small></a>`).join(''):'<p class="empty-hint">没有找到这个网站，换个关键词试试。</p>';
}
function renderPrompts() {
  const all=allPrompts(),q=$('#prompt-search').value.trim().toLowerCase();
  const cats=['全部','我的',...new Set(all.map(p=>p.cat))];
  if(!cats.includes(promptCategory))promptCategory='全部';
  $('#prompt-chips').innerHTML=cats.map(c=>`<button class="chip${c===promptCategory?' on':''}" data-category="${esc(c)}" aria-pressed="${c===promptCategory}">${esc(c)}</button>`).join('');
  const list=all.map((p,i)=>({...p,index:i})).filter(p=>(promptCategory==='全部'||(promptCategory==='我的'?p.mine:p.cat===promptCategory))&&[p.title,p.desc,p.text,p.cat].join(' ').toLowerCase().includes(q));
  $('#prompt-grid').innerHTML=list.length?list.map(p=>`<article class="pcard"><span class="category">${esc(p.cat)}</span><h3>${esc(p.title)}${p.mine?'<span class="badge-mine">我的</span>':''}</h3><p class="pdesc">${esc(p.desc)}</p><details><summary>查看完整提示词</summary><pre tabindex="0">${esc(p.text)}</pre></details><div class="prow"><span class="psrc">来源：${esc(p.src||'自己添加')}</span><span class="prow-btns"><button class="copy-btn" data-copy="${p.index}" aria-label="复制${esc(p.title)}">复制</button>${p.mine?`<button class="mini-btn" data-edit="${esc(p.id)}">编辑</button><button class="mini-btn danger" data-delete="${esc(p.id)}">删除</button>`:''}</span></div></article>`).join(''):'<p class="empty-hint"><strong>这里暂时没有提示词</strong>换个分类或关键词，也可以添加一条自己的提示词。</p>';
}
function renderWatch() {
  $('#watch-stats').innerHTML=[['全部',watchList.length],...['想看','在看','已看'].map(s=>[s,watchList.filter(w=>w.status===s).length])].map(([label,n])=>`<div class="watch-stat"><b>${n}</b>${label}</div>`).join('');
  $('#watch-chips').innerHTML=['全部','想看','在看','已看'].map(s=>`<button class="chip${s===watchStatus?' on':''}" data-watch-status="${s}" aria-pressed="${s===watchStatus}">${s}</button>`).join('');
  const type=$('#watch-type-filter').value,q=$('#watch-search').value.trim().toLowerCase();
  const list=watchList.filter(w=>(watchStatus==='全部'||w.status===watchStatus)&&(type==='全部'||w.type===type)&&(w.title+' '+w.note).toLowerCase().includes(q));
  $('#watch-grid').innerHTML=list.length?list.map(w=>`<article class="watch-card"><div class="w-top"><h3>${esc(w.title)}</h3><span class="w-status ${w.status==='已看'?'done':w.status==='在看'?'watching':''}">${w.status}</span></div><div class="w-meta">${esc(w.type)} · <span class="stars">${w.score?'★'.repeat(w.score)+'☆'.repeat(5-w.score):'还没打分'}</span> · ${esc(w.date)}</div>${w.note?`<p class="w-note">${esc(w.note)}</p>`:''}<div class="w-actions">${w.status!=='已看'?`<button class="mini-btn" data-next="${esc(w.id)}">${w.status==='想看'?'开始看':'看完了'}</button>`:''}<button class="mini-btn" data-watch-edit="${esc(w.id)}">编辑</button><button class="mini-btn danger" data-watch-delete="${esc(w.id)}">删除</button></div></article>`).join(''):`<p class="empty-hint"><strong>${watchList.length?'没有符合筛选的记录':'给下一次心动，留一张票。'}</strong>${watchList.length?'试试其他关键词或分类。':'还没有观影记录，点「添加一部」把想看的先记下来。'}</p>`;
}
function openPromptForm(p) {
  const categories=[...new Set(allPrompts().map(x=>x.cat))];
  $('#pf-cat').innerHTML=categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')+'<option value="__new">新建分类…</option>';
  $('#prompt-form').reset();$('#pf-id').value=p?.id||'';
  $('#prompt-form-title').textContent=p?'编辑提示词':'添加提示词';
  if(p)for(const field of ['title','cat','desc','text','src'])$('#pf-'+field).value=p[field]||'';
  $('#pf-cat-new').hidden=$('#pf-cat').value!=='__new';
  $('#prompt-form').hidden=false;$('#pf-title').focus();
}
function openWatchForm(w) {
  $('#watch-form').reset();$('#wf-id').value=w?.id||'';
  $('#watch-form-title').textContent=w?'编辑观影记录':'添加一部';
  if(w)for(const field of ['title','type','status','score','note'])$('#wf-'+field).value=String(w[field]??'');
  $('#watch-form').hidden=false;$('#wf-title').focus();
}
$('#prompt-form').addEventListener('submit',event=>{
  event.preventDefault();
  try {
    const category=$('#pf-cat').value==='__new'?$('#pf-cat-new').value.trim():$('#pf-cat').value;
    if(!category)throw Error('请输入新分类名称。');
    const record=normalizePrompt({id:$('#pf-id').value||uid(),title:$('#pf-title').value.trim(),cat:category,desc:$('#pf-desc').value.trim(),text:$('#pf-text').value.trim(),src:$('#pf-src').value.trim()});
    const next=myPrompts.some(p=>p.id===record.id)?myPrompts.map(p=>p.id===record.id?record:p):[record,...myPrompts];
    storeRecords('cyqing_my_prompts',next);myPrompts=next;$('#prompt-form').hidden=true;renderPrompts();renderHome();notify('提示词已保存到当前浏览器。');$('#prompt-add-btn').focus();
  } catch(e){notify(e.message,true);}
});
$('#watch-form').addEventListener('submit',event=>{
  event.preventDefault();
  try {
    const id=$('#wf-id').value||uid(),old=watchList.find(w=>w.id===id);
    const record=normalizeWatch({id,title:$('#wf-title').value.trim(),type:$('#wf-type').value,status:$('#wf-status').value,score:$('#wf-score').value,note:$('#wf-note').value.trim(),date:old?.date||today()});
    const next=old?watchList.map(w=>w.id===id?record:w):[record,...watchList];
    storeRecords('cyqing_watchlist',next);watchList=next;$('#watch-form').hidden=true;renderWatch();renderHome();notify('观影记录已保存到当前浏览器。');$('#watch-add-btn').focus();
  } catch(e){notify(e.message,true);}
});
document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  try {
    if(b.dataset.category!==undefined){promptCategory=b.dataset.category;renderPrompts();}
    if(b.dataset.watchStatus!==undefined){watchStatus=b.dataset.watchStatus;renderWatch();}
    if(b.dataset.copy!==undefined)copyText(allPrompts()[+b.dataset.copy].text,b);
    if(b.dataset.homeCopy!==undefined)copyText(allPrompts()[+b.dataset.homeCopy].text,b);
    if(b.dataset.edit)openPromptForm(myPrompts.find(p=>p.id===b.dataset.edit));
    if(b.dataset.watchEdit)openWatchForm(watchList.find(w=>w.id===b.dataset.watchEdit));
    if(b.dataset.delete){
      const p=myPrompts.find(p=>p.id===b.dataset.delete);
      if(p&&confirm(`确定删除「${p.title}」吗？`)){
        const next=myPrompts.filter(x=>x.id!==p.id);storeRecords('cyqing_my_prompts',next);myPrompts=next;renderPrompts();renderHome();notify('已删除提示词。');
      }
    }
    if(b.dataset.watchDelete){
      const w=watchList.find(w=>w.id===b.dataset.watchDelete);
      if(w&&confirm(`确定删除「${w.title}」的记录吗？`)){
        const next=watchList.filter(x=>x.id!==w.id);storeRecords('cyqing_watchlist',next);watchList=next;renderWatch();renderHome();notify('已删除观影记录。');
      }
    }
    if(b.dataset.next){
      const next=watchList.map(w=>w.id===b.dataset.next?{...w,status:w.status==='想看'?'在看':'已看'}:w);
      storeRecords('cyqing_watchlist',next);watchList=next;renderWatch();renderHome();
    }
    if(b.dataset.reload)loadTool(b.dataset.reload,true);
  }catch(e){notify(e.message,true);}
});
$('#prompt-add-btn').onclick=()=>openPromptForm();$('#watch-add-btn').onclick=()=>openWatchForm();
$('#prompt-form-cancel').onclick=()=>{$('#prompt-form').hidden=true;$('#prompt-add-btn').focus();};
$('#watch-form-cancel').onclick=()=>{$('#watch-form').hidden=true;$('#watch-add-btn').focus();};
$('#pf-cat').onchange=()=>{$('#pf-cat-new').hidden=$('#pf-cat').value!=='__new';if(!$('#pf-cat-new').hidden)$('#pf-cat-new').focus();};
$('#prompt-search').oninput=renderPrompts;$('#site-search').oninput=renderSites;$('#watch-search').oninput=renderWatch;$('#watch-type-filter').onchange=renderWatch;
$('#prompt-export-btn').onclick=()=>exportRecords('cyqing_my_prompts',myPrompts,'my-prompts.json');
$('#watch-export-btn').onclick=()=>exportRecords('cyqing_watchlist',watchList,'my-watchlist.json');
function bindImport(kind,key,normalize,getRecords,setRecords) {
  $('#'+kind+'-import-btn').onclick=()=>$('#'+kind+'-import-file').click();
  $('#'+kind+'-import-file').onchange=async event=>{
    const input=event.target,file=input.files[0];if(!file)return;
    try {
      if(file.size>5*1024*1024)throw Error('导入文件超过 5 MB，请拆分后重试。');
      const data=JSON.parse(await file.text());if(!Array.isArray(data))throw Error('请导入导出的 JSON 数组文件。');
      const incoming=data.map(normalize);
      const unique=new Map();for(const record of incoming)unique.set(record.id,record);
      const next=[...unique.values(),...getRecords().filter(x=>!unique.has(x.id))];
      storeRecords(key,next);setRecords(next);renderPrompts();renderWatch();renderHome();notify(`导入成功，共读取 ${incoming.length} 条记录。`);
    }catch(e){notify('导入失败：'+(e instanceof SyntaxError?'文件不是有效的 JSON。':e.message)+' 原有记录未改动。',true);}
    finally{input.value='';}
  };
}
bindImport('prompt','cyqing_my_prompts',normalizePrompt,()=>myPrompts,next=>myPrompts=next);
bindImport('watch','cyqing_watchlist',normalizeWatch,()=>watchList,next=>watchList=next);

const toolState=new Map();
// Embedded tools have tall documents. Their dialogs must use the visible outer
// viewport rather than the full iframe height when choosing a position.
let dialogFrame;
function updateToolDialogs() {
  cancelAnimationFrame(dialogFrame);
  dialogFrame=requestAnimationFrame(()=>{for(const state of toolState.values())state.positionDialogs?.();});
}
window.addEventListener('scroll',updateToolDialogs,{passive:true});
window.addEventListener('resize',updateToolDialogs);
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.data?.type!=='cyqing:notice'||typeof event.data.message!=='string')return;
  if(currentView==='video'&&event.source===$('#video-frame').contentWindow)notify(event.data.message.slice(0,1000));
});
function loadTool(name,force=false) {
  const frame=$('#'+name+'-frame'),status=$('#'+name+'-frame-status');
  if(frame.hasAttribute('src')&&!force)return;
  const old=toolState.get(name);if(old){clearTimeout(old.timer);old.observer?.disconnect();old.modalObserver?.disconnect();old.dialogObserver?.disconnect();}
  const state={};toolState.set(name,state);
  status.classList.remove('error');status.hidden=false;status.textContent='正在打开工具…';
  const fail=message=>{status.hidden=false;status.classList.add('error');status.textContent=message;};
  frame.onload=()=>{
    clearTimeout(state.timer);state.observer?.disconnect();state.modalObserver?.disconnect();state.dialogObserver?.disconnect();state.positionDialogs=null;
    try {
      const doc=frame.contentDocument;
      if(!doc?.querySelector('main')||/bad gateway|portal missing/i.test(doc.body.textContent.trim()))throw Error('unavailable');
      status.hidden=true;
      state.positionDialogs=()=>{
        if(!frame.getClientRects().length)return;
        const bounds=frame.getBoundingClientRect(),nav=$('.sidebar').getBoundingClientRect();
        const inset=nav.width>=innerWidth*.8?nav.bottom+12:16;
        const visibleTop=Math.max(inset,bounds.top+12),visibleBottom=Math.min(innerHeight-16,bounds.bottom-12);
        const available=visibleBottom-visibleTop;
        if(available<100)return;
        doc.querySelectorAll('dialog[open]').forEach(dialog=>{
          Object.assign(dialog.style,{position:'fixed',margin:'0 auto',left:'0',right:'0',bottom:'auto',maxHeight:available+'px'});
          const video=dialog.querySelector('video');if(video)video.style.maxHeight=Math.max(80,available-155)+'px';
          const log=dialog.querySelector('#log-content');if(log)log.style.maxHeight=Math.max(80,available-155)+'px';
          const height=dialog.getBoundingClientRect().height;
          dialog.style.top=Math.round(visibleTop-bounds.top+Math.max(0,(available-height)/2))+'px';
        });
      };
      state.modalObserver=new MutationObserver(state.positionDialogs);
      state.modalObserver.observe(doc.documentElement,{attributes:true,attributeFilter:['open'],subtree:true});
      state.dialogObserver=new ResizeObserver(state.positionDialogs);
      doc.querySelectorAll('dialog').forEach(dialog=>state.dialogObserver.observe(dialog));
      const resize=()=>{
        const height=Math.max(600,Math.min(24000,doc.body.scrollHeight+28));
        if(Math.abs(parseInt(frame.style.height||'0')-height)>4)frame.style.height=height+'px';
        state.positionDialogs();
      };
      state.observer=new ResizeObserver(resize);state.observer.observe(doc.body);resize();
    }catch{fail('工具暂时无法加载。请稍后重新连接，或使用「独立打开」。');}
  };
  frame.onerror=()=>{clearTimeout(state.timer);fail('工具连接失败，请重新连接或独立打开。');};
  state.timer=setTimeout(()=>fail('工具加载较慢。可以继续等待，或使用「重新连接」与「独立打开」。'),15000);
  frame.src=frame.dataset.src;
}
const pages={
  home:['工作台','给好用的东西，留个位置。','我是陈玉庆，在这里做工具、收集灵感，也记录生活。'],
  collection:['网站收藏','值得再打开的，都放在这里。','设计、开发与创作时，顺手收藏的好网站。'],
  prompts:['提示词库','好用的提示词，不用每次从头想。','按场景找一条，复制就能用；也欢迎加上自己的版本。'],
  watch:['观影记录','生活里，也有值得记住的片刻。','电影、动漫与电视剧，留下一点自己的感受。'],
  video:['随手存','把喜欢的视频，留在设备里。','粘贴分享链接，解析、预览和保存，一处完成。'],
  files:['文件小站','传个文件，不用绕远路。','手机与电脑之间，给文件一个中转的地方。']
};
function route(focus=false) {
  const path=(location.hash||'#/').replace(/^#\/?/,'').replace(/\/$/,'');
  const aliases={'':'home',entertainment:'watch',watch:'watch',douyin:'video'};
  currentView=aliases[path]||path;if(!pages[currentView])currentView='home';
  clearTimeout(noticeTimer);$('#notice').hidden=true;
  const [label,title,desc]=pages[currentView];
  document.querySelectorAll('[data-view]').forEach(view=>view.hidden=view.dataset.view!==currentView);
  document.querySelectorAll('[data-page]').forEach(a=>{const active=a.dataset.page===currentView;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  $('#crumb-current').textContent=label;$('#page-title').textContent=title;$('#page-desc').textContent=desc;document.title=label+' · 陈玉庆';
  if(currentView==='home')renderHome();if(currentView==='collection')renderSites();if(currentView==='prompts')renderPrompts();if(currentView==='watch')renderWatch();
  if(currentView==='video'||currentView==='files')loadTool(currentView);
  window.scrollTo(0,0);
  if(focus)$('#main').focus({preventScroll:true});
}
window.addEventListener('hashchange',()=>route(true));
window.addEventListener('storage',event=>{
  if(event.key==='cyqing_my_prompts')myPrompts=readRecords(event.key,normalizePrompt);
  if(event.key==='cyqing_watchlist')watchList=readRecords(event.key,normalizeWatch);
  if(event.key===null){myPrompts=readRecords('cyqing_my_prompts',normalizePrompt);watchList=readRecords('cyqing_watchlist',normalizeWatch);}
  renderHome();renderPrompts();renderWatch();
});
$('#today').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
renderHome();renderPrompts();renderWatch();route();
