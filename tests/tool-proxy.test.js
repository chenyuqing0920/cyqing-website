import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { toolProxy,toolUpstreams } from '../server/tool-proxy.js';

// Fake upstreams record what they receive; the proxy runs inside a tiny
// Express app mounted under BASE_PATH=/life, like production on Muse.
let files,douyin,site,siteUrl,seen=[];
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
function fake(name){return http.createServer((req,res)=>{let size=0;req.on('data',c=>size+=c.length);req.on('end',()=>{seen.push({name,method:req.method,url:req.url,host:req.headers.host,origin:req.headers.origin,size});res.setHeader('content-type','application/json');res.setHeader('content-security-policy',"default-src 'none'");res.end(JSON.stringify({ok:true,name,url:req.url,passwordRequired:false}));});});}
before(async()=>{
  files=fake('files');douyin=fake('douyin');
  const fp=await listen(files),dp=await listen(douyin);
  const up=toolUpstreams({FILE_DROP_URL:`http://127.0.0.1:${fp}`,DOUYIN_URL:`http://127.0.0.1:${dp}`,FILE_DROP_MAX_MB:'1'});
  const dead={name:'文件小站',target:new URL('http://127.0.0.1:9'),prefix:'/files',maxBytes:1024};
  const app=express(),r=express.Router();
  r.use('/files',...toolProxy('files',up.files,{publicBase:'https://tool.cyqing.icu',writeLimit:5}));
  r.use('/douyin',...toolProxy('douyin',up.douyin,{publicBase:'https://tool.cyqing.icu'}));
  r.use('/dead',...toolProxy('files',dead,{publicBase:'https://tool.cyqing.icu'}));
  r.get('/{*path}',(req,res)=>res.type('html').send('<!doctype html>spa'));
  app.use('/life',r);
  site=http.createServer(app);siteUrl=`http://127.0.0.1:${await listen(site)}/life`;
});
after(()=>{for(const s of [files,douyin,site])s.close();});

test('upstream defaults and LEGACY_BASE_URL fallback',()=>{
  const d=toolUpstreams({});assert.equal(d.files.target.origin,'http://127.0.0.1:7864');assert.equal(d.douyin.target.origin,'http://127.0.0.1:7863');assert.equal(d.douyin.prefix,'');
  const l=toolUpstreams({LEGACY_BASE_URL:'https://old.example/base',TOOLS_USE_LEGACY:'1'});assert.equal(l.files.target.host,'old.example');assert.equal(l.douyin.prefix,'/douyin');
  assert.equal(toolUpstreams({LEGACY_BASE_URL:'http://127.0.0.1:7860'}).files.target.port,'7864','legacy is opt-in');
});

test('BASE_PATH routes proxy to the right upstream paths without a password',async()=>{
  seen=[];
  let res=await fetch(siteUrl+'/files/api/list');assert.equal(res.status,200);let body=await res.json();assert.equal(body.name,'files');assert.equal(body.url,'/files/api/list');assert.equal(body.passwordRequired,false);
  assert.equal(res.headers.get('content-security-policy'),null,'upstream CSP is not forwarded');
  res=await fetch(siteUrl+'/douyin/api/session');body=await res.json();assert.equal(body.name,'douyin');assert.equal(body.url,'/api/session','douyin prefix stripped');
  res=await fetch(siteUrl+'/douyin/api/jobs',{method:'POST',headers:{'content-type':'application/json',origin:siteUrl.replace('/life','')},body:'{"text":"x"}'});assert.equal(res.status,200);
  const post=seen.at(-1);assert.equal(post.method,'POST');assert.equal(post.size,12);assert.equal(post.host,new URL(siteUrl).host,'browser Host kept for loopback upstreams');
  res=await fetch(siteUrl+'/files/api/delete',{method:'POST',headers:{'content-type':'application/json',origin:'https://tool.cyqing.icu'},body:'{"name":"a"}'});assert.equal(res.status,200,'PUBLIC_BASE_URL origin allowed');
});

test('cross-site writes, oversize bodies and write floods are refused',async()=>{
  let res=await fetch(siteUrl+'/files/api/delete',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body:'{"name":"a"}'});assert.equal(res.status,403);assert.match((await res.json()).error,/来源/);
  res=await fetch(siteUrl+'/files/api/delete',{method:'POST',headers:{'content-type':'application/json','sec-fetch-site':'cross-site'},body:'{}'});assert.equal(res.status,403);
  res=await fetch(siteUrl+'/files/api/upload',{method:'POST',headers:{origin:new URL(siteUrl).origin},body:Buffer.alloc(1024*1024+10)});assert.equal(res.status,413);
  let last;for(let i=0;i<8;i++)last=await fetch(siteUrl+'/files/api/delete',{method:'POST',headers:{'content-type':'application/json',origin:new URL(siteUrl).origin},body:'{}'});assert.equal(last.status,429);
});

test('unreachable upstream gives JSON 502, not SPA HTML or 404',async()=>{
  const res=await fetch(siteUrl+'/dead/api/list');assert.equal(res.status,502);assert.match(res.headers.get('content-type'),/json/);
  const body=await res.json();assert.equal(body.upstream,'unreachable');assert.match(body.error,/连不上/);
});
