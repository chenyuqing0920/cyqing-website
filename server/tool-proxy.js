// Same-origin reverse proxy for the two password-free tools (随手存 / 文件小站).
// The browser only ever talks to this site, so CSP connect-src 'self' holds,
// and the Python services stay on loopback. Bodies are streamed both ways
// (no buffering), so large uploads and video relays do not sit in memory.
import http from 'node:http';
import https from 'node:https';
import { rateLimit } from 'express-rate-limit';

const SAFE=['GET','HEAD','OPTIONS'];

function parseTarget(raw,fallback){
  const value=(raw||'').trim()||fallback;
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('工具上游地址无效: '+value);
  return url;
}
const isLoopback=url=>['127.0.0.1','localhost','[::1]','::1'].includes(url.hostname);

// Resolve upstreams. Explicit FILE_DROP_URL / DOUYIN_URL win; with
// TOOLS_USE_LEGACY=1 the LEGACY_BASE_URL front proxy (which already routes
// /files and /douyin) is reused; otherwise the services are expected on their default loopback ports.
// File uploads are uncapped by default (disk space is the only bound).
// Set FILE_DROP_MAX_MB to re-impose a per-request cap in megabytes.
function fileMaxBytes(env){
  const mb=Number(env.FILE_DROP_MAX_MB);
  return Number.isFinite(mb)&&mb>0?mb*1024*1024:Infinity;
}

export function toolUpstreams(env=process.env){
  let legacy=null;
  if(env.TOOLS_USE_LEGACY==='1'&&env.LEGACY_BASE_URL){try{legacy=parseTarget(env.LEGACY_BASE_URL);}catch{legacy=null;}}
  return {
    files:env.FILE_DROP_URL||!legacy
      ?{name:'文件小站',target:parseTarget(env.FILE_DROP_URL,'http://127.0.0.1:7864'),prefix:'/files',maxBytes:fileMaxBytes(env)}
      :{name:'文件小站',target:legacy,prefix:'/files',maxBytes:fileMaxBytes(env)},
    // linux_server.py serves at "/", so the /douyin prefix is stripped,
    // except behind the legacy front proxy which strips it itself.
    douyin:env.DOUYIN_URL||!legacy
      ?{name:'随手存',target:parseTarget(env.DOUYIN_URL,'http://127.0.0.1:7863'),prefix:'',maxBytes:64*1024}
      :{name:'随手存',target:legacy,prefix:'/douyin',maxBytes:64*1024},
  };
}

function allowedOrigin(req,publicBase){
  const origin=req.get('origin');
  if(origin){
    if(origin==='null')return false;
    let o;try{o=new URL(origin);}catch{return false;}
    if(o.host===req.get('host'))return true;
    try{if(publicBase&&new URL(publicBase).origin===o.origin)return true;}catch{}
    if(process.env.NODE_ENV==='development'&&['127.0.0.1:5173','localhost:5173'].includes(o.host))return true;
    return false;
  }
  // No Origin header: only accept when the browser says it is not cross-site.
  const site=req.get('sec-fetch-site');
  return !site||site==='same-origin'||site==='none';
}

const HOP=['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host'];

export function toolProxy(key,upstream,{publicBase=process.env.PUBLIC_BASE_URL,writeLimit=Number(process.env.TOOL_WRITE_LIMIT_PER_MIN||60),readLimit=Number(process.env.TOOL_READ_LIMIT_PER_MIN||600)}={}){
  const json=(res,status,body)=>{if(!res.headersSent)res.status(status).set('Cache-Control','no-store').json(body);else res.destroy();};
  const writes=rateLimit({windowMs:60*1000,limit:writeLimit,standardHeaders:'draft-7',legacyHeaders:false,skip:req=>SAFE.includes(req.method),message:{error:`${upstream.name}操作太频繁，请稍后再试`}});
  const reads=rateLimit({windowMs:60*1000,limit:readLimit,standardHeaders:'draft-7',legacyHeaders:false,skip:req=>!SAFE.includes(req.method),message:{error:`${upstream.name}请求太频繁，请稍后再试`}});
  const client=upstream.target.protocol==='https:'?https:http;
  const proxy=(req,res)=>{
    if(!SAFE.includes(req.method)&&!allowedOrigin(req,publicBase))return json(res,403,{error:'请求来源不匹配',tool:key});
    const length=Number(req.get('content-length')||0);
    if(length>upstream.maxBytes)return json(res,413,{error:`${upstream.name}单次请求超过大小限制`,tool:key});
    const headers={};
    for(const [k,v] of Object.entries(req.headers))if(!HOP.includes(k))headers[k]=v;
    // Password-free front door: the proxy proves itself to the loopback
    // upstreams with a shared secret from site.env. Set server-side, so it
    // overwrites any browser-spoofed value and never reaches the browser.
    if(process.env.TOOL_PROXY_SECRET)headers['x-tool-proxy-key']=process.env.TOOL_PROXY_SECRET;
    const loop=isLoopback(upstream.target);
    // Loopback services see the public Host so their own same-origin check
    // matches the browser Origin; a remote upstream needs its own Host/Origin.
    headers.host=loop?req.get('host'):upstream.target.host;
    if(!loop&&headers.origin)headers.origin=upstream.target.origin;
    headers['x-forwarded-for']=[req.get('x-forwarded-for'),req.socket.remoteAddress].filter(Boolean).join(', ');
    headers['x-forwarded-proto']=req.get('x-forwarded-proto')||req.protocol;
    headers['x-forwarded-host']=req.get('host');
    const basePath=upstream.target.pathname.replace(/\/$/,'');
    const path=basePath+upstream.prefix+req.url;
    let seen=0;
    const up=client.request({protocol:upstream.target.protocol,hostname:upstream.target.hostname.replace(/^\[|\]$/g,''),port:upstream.target.port||(upstream.target.protocol==='https:'?443:80),method:req.method,path,headers,timeout:Number(process.env.TOOL_UPSTREAM_TIMEOUT_MS||120000)},upRes=>{
      res.status(upRes.statusCode||502);
      for(const [k,v] of Object.entries(upRes.headers)){if(HOP.includes(k)||k==='content-security-policy')continue;res.setHeader(k,v);}
      upRes.pipe(res);
      upRes.on('error',()=>res.destroy());
    });
    up.on('timeout',()=>up.destroy(Object.assign(new Error('timeout'),{code:'ETIMEDOUT'})));
    up.on('error',err=>{
      console.error(`Tool upstream ${key} failed:`,err.code||err.message);
      json(res,err.code==='ETIMEDOUT'?504:502,{error:`${upstream.name}服务暂时连不上，请确认它已启动（${err.code||'upstream error'}）`,tool:key,upstream:'unreachable'});
    });
    req.on('data',chunk=>{seen+=chunk.length;if(seen>upstream.maxBytes){up.destroy();json(res,413,{error:`${upstream.name}单次请求超过大小限制`,tool:key});req.destroy();}});
    req.on('aborted',()=>up.destroy());
    req.pipe(up);
  };
  return [reads,writes,proxy];
}
