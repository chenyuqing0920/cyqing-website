'use strict';
// Path prefix of this app as seen by the browser: '' when served standalone
// at the root, '/douyin' when the portal proxy mounts it under /douyin.
// Video preview / origin links must stay under the same prefix: a bare
// '/files/<id>' at the portal belongs to the file station, not this app.
const APP_PREFIX = window.location.pathname.replace(/\/+$/, '');
let csrf = '', timer, lastSnapshot = '', noticeTimer;
const $ = id => document.getElementById(id);
// A same-origin portal embeds this tool while keeping its own navigation visible.
// External scripts remain compatible with the strict script-src 'self' policy.
document.body.classList.toggle('embedded',window.self!==window.top);
document.title='随手存 · 视频下载';
const theme=document.querySelector('meta[name="theme-color"]');
if(theme)theme.setAttribute('content','#f6f8f7');
function connection(text,state='pending'){
  const el=document.querySelector('.connection');if(!el)return;
  el.dataset.state=state;
  let label=el.querySelector('.connection-label');
  if(!label){label=node('span','connection-label');el.replaceChildren(node('i'),label);}
  label.textContent=text;
}
connection('等待验证');
const states = {queued:'排队中',resolving:'解析中',ready:'可下载',failed:'未完成',cancelled:'已取消'};
function notify(text) {
  if(window.self!==window.top){
    window.parent.postMessage({type:'cyqing:notice',message:text},window.location.origin);
    return;
  }
  $('notice').textContent=text; $('notice').hidden=false; clearTimeout(noticeTimer); noticeTimer=setTimeout(()=>$('notice').hidden=true,10000);
}
async function api(path, options={}) {
  const headers={...(options.body?{'Content-Type':'application/json'}:{}), ...(csrf?{'X-CSRF-Token':csrf}:{}),...options.headers};
  const response=await fetch(path,{...options,headers,cache:'no-store',credentials:'same-origin'});
  const data=await response.json();
  if(!response.ok){if(response.status===401 && path!=='/api/login')showLogin();throw new Error(data.error||'连接失败，请稍后重试');}
  return data;
}
function showLogin(){csrf='';lastSnapshot='';clearTimeout(timer);clearTimeout(noticeTimer);$('notice').hidden=true;$('login-panel').hidden=false;$('workspace').hidden=true;connection('未登录');}
function showWorkspace(token){csrf=token;$('login-panel').hidden=true;$('workspace').hidden=false;connection('正在读取记录');refresh();}
function node(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function size(value){return (value/1048576).toFixed(1)+' MB';}
function relayDownload(job){
  // Server streaming relay (no disk cache): the browser downloads from this
  // same-origin endpoint, so Douyin's cross-origin read limit no longer
  // applies and there is no 128 MB in-browser blob limit.
  const link=node('a');
  link.href=APP_PREFIX+'/files/'+job.id+'/relay';
  document.body.append(link);link.click();link.remove();
  notify('已开始经服务器中转下载，请在浏览器下载列表确认保存。');
}
function render(jobs){
  const snapshot=JSON.stringify(jobs);if(lastSnapshot===snapshot)return;lastSnapshot=snapshot;
  $('job-count').textContent=jobs.length;
  $('jobs').replaceChildren();
  if(!jobs.length){
    const empty=node('div','empty'),icon=node('span','','↓');
    icon.setAttribute('aria-hidden','true');
    empty.append(icon,node('h3','','还没有解析记录'),node('p','','粘贴链接，开始保存第一条视频。'));
    $('jobs').append(empty);return;
  }
  for(const job of jobs){
    const card=node('article','job');card.dataset.state=job.state;card.dataset.key=job.id;
    const top=node('div','job-top'), icon=node('span','job-icon',job.state==='ready'?'✓':'↓'), info=node('div','job-info');
    info.append(node('h3','',job.title),node('p','job-message',job.message));top.append(icon,info,node('span','job-status',states[job.state]||job.state));card.append(top);
    const footer=node('div','job-footer'),actions=node('div','job-actions'),secondary=node('div','job-secondary');
    footer.append(node('small','',job.state==='ready'?'中转下载':'单个视频作品'));
    if(job.state==='ready'){
      const preview=node('button','preview-button','预览');preview.type='button';preview.onclick=()=>{$('preview-video').src=APP_PREFIX+'/files/'+job.id;$('preview-dialog').showModal();};
      const save=node('button','save-button','下载 ↓');save.type='button';save.onclick=()=>relayDownload(job);actions.append(preview,save);
      const origin=node('a','text-button','源站打开 ↗');origin.href=APP_PREFIX+'/files/'+job.id;origin.target='_blank';origin.rel='noopener noreferrer';origin.referrerPolicy='no-referrer';secondary.append(origin);
      const retry=node('button','text-button','重新解析');retry.onclick=async()=>{try{await api('/api/jobs',{method:'POST',body:JSON.stringify({text:job.link})});refresh();}catch(e){notify(e.message);}};secondary.append(retry);
    }else if(['queued','resolving'].includes(job.state)){
      const cancel=node('button','text-button','取消');cancel.onclick=async()=>{try{await api('/api/jobs/'+job.id+'/cancel',{method:'POST',body:'{}'});refresh();}catch(e){notify(e.message);}};actions.append(cancel);
    }else{const retry=node('button','text-button','重试');retry.onclick=async()=>{try{await api('/api/jobs',{method:'POST',body:JSON.stringify({text:job.link})});refresh();}catch(e){notify(e.message);}};actions.append(retry);}
    footer.append(actions);card.append(footer);if(secondary.childElementCount)card.append(secondary);$('jobs').append(card);
  }
}
async function refresh(){clearTimeout(timer);if(!csrf)return;try{const data=await api('/api/jobs');render(data.jobs);connection('已连接','online');}catch(e){if(csrf){notify('暂时无法读取记录，请稍后刷新或检查服务。');connection('连接中断','error');}}finally{if(csrf)timer=setTimeout(refresh,2500);}}
$('login-form').onsubmit=async event=>{event.preventDefault();$('login-button').disabled=true;try{const data=await api('/api/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';showWorkspace(data.csrf);}catch(e){notify(e.message);}finally{$('login-button').disabled=false;}};
$('toggle-password').onclick=()=>{const hidden=$('password').type==='password';$('password').type=hidden?'text':'password';$('toggle-password').textContent=hidden?'隐藏':'显示';$('toggle-password').setAttribute('aria-label',hidden?'隐藏访问密码':'显示访问密码');};
$('download-form').onsubmit=async event=>{event.preventDefault();$('submit-button').disabled=true;try{await api('/api/jobs',{method:'POST',body:JSON.stringify({text:$('share-text').value})});$('share-text').value='';notify('正在解析。完成后点击“下载”，经服务器中转保存到你的设备。');await refresh();}catch(e){notify(e.message);}finally{$('submit-button').disabled=false;}};
$('clear-button').onclick=()=>{$('share-text').value='';$('share-text').focus();};
$('refresh-button').onclick=refresh;
$('logout-button').onclick=async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});showLogin();}catch(e){notify(e.message);}};
$('close-preview').onclick=()=>$('preview-dialog').close();
let logTimer;
async function refreshLogs(){try{const data=await api('/api/logs?limit=300');const el=$('log-content');el.textContent=data.logs.length?data.logs.join('\n'):'暂无日志';el.scrollTop=el.scrollHeight;}catch(e){}}
$('log-button').onclick=()=>{$('log-dialog').showModal();refreshLogs();clearInterval(logTimer);logTimer=setInterval(()=>{if($('log-dialog').open)refreshLogs();},3000);};
$('close-log').onclick=()=>$('log-dialog').close();
$('log-dialog').addEventListener('close',()=>clearInterval(logTimer));
$('preview-dialog').addEventListener('close',()=>{$('preview-video').pause();$('preview-video').removeAttribute('src');$('preview-video').load();});
$('preview-video').addEventListener('error',()=>notify('源站拒绝直连或地址已过期，请重新解析。'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&csrf)refresh();});
api('/api/session').then(data=>showWorkspace(data.csrf)).catch(()=>showLogin());
