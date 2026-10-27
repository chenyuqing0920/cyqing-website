import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';

dotenv.config();
if(!process.env.TEST_DATABASE_URL||!process.env.TEST_DATABASE_URL.startsWith('file:')||!process.env.TEST_DATABASE_URL.includes('digital_space_test'))throw new Error('Tests require an isolated digital_space_test SQLite database');
const base='http://127.0.0.1:3071',prefix=process.env.TEST_BASE_PATH||'',secure=process.env.TEST_SECURE==='1',publicOrigin=secure?'https://tool.cyqing.icu':base,origin={Origin:publicOrigin,...(secure?{'X-Forwarded-Proto':'https'}:{})};
const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
const username='integration-admin',password=crypto.randomBytes(24).toString('base64url');let child,cookie='',csrf='',privateNote,assetId,backupBody,travelId,animeId;
async function call(url,{method='GET',body,auth=false,extra={}}={}){
  const headers={...origin,...extra};if(auth){headers.Cookie=cookie;if(method!=='GET')headers['X-CSRF-Token']=csrf;}let payload=body;
  if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';payload=JSON.stringify(body);}
  const res=await fetch(base+prefix+url,{method,headers,body:payload});return res;
}
async function start(){
  child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,UPLOAD_DIR:'./data/test-uploads',BASE_PATH:prefix,PORT:'3071',PUBLIC_BASE_URL:publicOrigin,NODE_ENV:secure?'production':'test',COOKIE_SECURE:secure?'true':'false',TRUST_PROXY:secure?'1':'0'},stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch(base+prefix+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Test server did not start');
}
async function stop(){if(!child||child.exitCode!==null)return;const pid=child.pid;child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);if(process.platform==='win32'&&child.exitCode===null)spawn('taskkill',['/PID',String(pid),'/F'],{stdio:'ignore'});}
before(async()=>{await db.user.upsert({where:{username},create:{username,passwordHash:await bcrypt.hash(password,12)},update:{passwordHash:await bcrypt.hash(password,12)}});await start();});
after(async()=>{await stop();await db.$disconnect();});

test('authentication, CSRF, privacy, persistence, image integrity and backup restore',async()=>{
  let res=await call('/api/records/note',{method:'POST',body:{title:'no access'}});assert.equal(res.status,401);
  res=await call('/api/records/todo');assert.equal(res.status,401);
  res=await call('/api/auth/login',{method:'POST',body:{username,password}});assert.equal(res.status,200);assert.match(res.headers.get('set-cookie'),/HttpOnly/);assert.match(res.headers.get('set-cookie'),/SameSite=Strict/);if(secure)assert.match(res.headers.get('set-cookie'),/Secure/);cookie=res.headers.get('set-cookie').split(';')[0];csrf=(await res.json()).csrf;assert.equal(csrf.length,64);
  res=await call('/api/records/note',{method:'POST',body:{title:'csrf denied'},extra:{Cookie:cookie}});assert.equal(res.status,403);
  res=await call('/api/records/note',{method:'POST',auth:true,extra:{Origin:'https://evil.example'},body:{title:'origin denied'}});assert.equal(res.status,403);
  res=await call('/api/records/note',{method:'POST',auth:true,body:{title:'private',content:'private content',tags:['secret'],isPublic:false,isDraft:false}});assert.equal(res.status,201);privateNote=await res.json();
  assert.equal((await call('/api/records/note/'+privateNote.id)).status,404);assert.equal((await (await call('/api/records/note')).json()).items.some(x=>x.id===privateNote.id),false);
  const secondLogin=await call('/api/auth/login',{method:'POST',body:{username,password}});assert.equal(secondLogin.status,200);const secondCookie=secondLogin.headers.get('set-cookie').split(';')[0];assert.notEqual(secondCookie,cookie);
  const secondClient=await fetch(base+prefix+'/api/records/note/'+privateNote.id,{headers:{Cookie:secondCookie}});assert.equal(secondClient.status,200);assert.equal((await secondClient.json()).content,'private content');
  res=await call('/api/tags/secret',{method:'PUT',auth:true,body:{name:'renamed'}});assert.equal(res.status,200);assert.deepEqual((await (await call('/api/records/note/'+privateNote.id,{auth:true})).json()).tags,['renamed']);
  res=await call('/api/tags',{auth:true});assert.ok((await res.json()).items.includes('renamed'));
  res=await call('/api/records/travel',{method:'POST',auth:true,body:{title:'Persisted trip',city:'Test City',status:'已去',startDate:'2025-05-01',endDate:'2025-05-03',latitude:24,longitude:118,isPublic:false,tags:['test'],photoIds:[]}});assert.equal(res.status,201);travelId=(await res.json()).id;
  assert.equal((await call('/api/records/travel/'+travelId)).status,404);
  res=await call('/api/records/travel/'+travelId,{auth:true});assert.equal((await res.json()).city,'Test City');
  res=await call('/api/records/anime',{method:'POST',auth:true,body:{title:'Test anime',status:'在看',totalEpisodes:12,currentEpisode:1,tags:[],isPublic:false}});assert.equal(res.status,201);animeId=(await res.json()).id;
  res=await call('/api/records/anime/'+animeId,{method:'PUT',auth:true,body:{title:'Test anime',status:'在看',totalEpisodes:12,currentEpisode:5,score:8,tags:[],isPublic:false}});assert.equal(res.status,200);assert.equal((await res.json()).currentEpisode,5);
  res=await call('/api/records/anime/'+animeId,{method:'PUT',auth:true,body:{title:'Test anime',status:'在看',totalEpisodes:12,currentEpisode:99,tags:[],isPublic:false}});assert.equal(res.status,400);
  res=await call('/api/records/travel',{method:'POST',auth:true,body:{title:'Bad date',status:'已去',startDate:'2026-99-99'}});assert.equal(res.status,400);
  const image=await sharp({create:{width:24,height:24,channels:3,background:'#ff9999'}}).png().toBuffer();const form=new FormData();form.append('image',new Blob([image],{type:'image/png'}),'sample.png');res=await call('/api/media',{method:'POST',auth:true,body:form});assert.equal(res.status,201);assetId=(await res.json()).id;
  assert.equal((await call('/api/media/'+assetId)).status,404);res=await call('/api/media/'+assetId,{auth:true});assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),'image/webp');assert.equal((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).format,'webp');
  res=await call('/api/records/travel/'+travelId,{method:'PUT',auth:true,body:{title:'Persisted trip',city:'Test City',status:'已去',startDate:'2025-05-01',endDate:'2025-05-03',latitude:24,longitude:118,isPublic:true,tags:['test'],photoIds:[assetId]}});assert.equal(res.status,200);assert.equal((await call('/api/media/'+assetId)).status,200);
  res=await call('/api/records/travel/'+travelId,{method:'PUT',auth:true,body:{title:'Persisted trip',city:'Test City',status:'已去',latitude:24,longitude:118,isPublic:false,tags:['test'],photoIds:[assetId]}});assert.equal(res.status,200);assert.equal((await call('/api/media/'+assetId)).status,404);
  res=await call('/api/drafts/new',{method:'PUT',auth:true,body:{title:'Draft',content:'saved draft',tags:[],isPublic:false,isDraft:true}});assert.equal(res.status,200);
  res=await call('/api/records/todo',{method:'POST',auth:true,body:{title:'Task',done:false}});assert.equal(res.status,201);
  res=await call('/api/records/countdown',{method:'POST',auth:true,body:{title:'Event',targetDate:'2028-05-01'}});assert.equal(res.status,201);
  res=await call('/api/records/bookmark',{method:'POST',auth:true,body:{title:'Example',url:'https://example.com',category:'test'}});assert.equal(res.status,201);
  res=await call('/api/records/bookmark',{method:'POST',auth:true,body:{title:'Bad',url:'javascript:alert(1)',category:'test'}});assert.equal(res.status,400);
  res=await call('/api/backup',{auth:true});assert.equal(res.status,200);backupBody=await res.json();assert.ok(backupBody.files.some(x=>x.id===assetId));assert.ok(backupBody.drafts.some(x=>x.key==='new'));
  const invalid=structuredClone(backupBody);invalid.files[0].sha256='invalid';res=await call('/api/backup/restore',{method:'POST',auth:true,body:invalid});assert.equal(res.status,400);assert.equal((await call('/api/records/note/'+privateNote.id,{auth:true})).status,200);
  res=await call('/api/records/note/'+privateNote.id,{method:'DELETE',auth:true});assert.equal(res.status,200);
  res=await call('/api/backup/restore',{method:'POST',auth:true,body:backupBody});assert.equal(res.status,200);
  assert.equal((await (await call('/api/records/note/'+privateNote.id,{auth:true})).json()).content,'private content');assert.equal((await (await call('/api/drafts/new',{auth:true})).json()).data.content,'saved draft');
  assert.equal((await call('/api/media/'+assetId,{auth:true})).status,200);assert.equal((await call('/api/media/'+assetId)).status,404);
  await stop();await db.$disconnect();await db.$connect();await start();
  res=await call('/api/auth/session',{auth:true});assert.equal((await res.json()).authenticated,true);
  assert.equal((await (await call('/api/records/anime/'+animeId,{auth:true})).json()).currentEpisode,5);
  assert.equal((await (await call('/api/records/travel/'+travelId,{auth:true})).json()).city,'Test City');
  assert.equal((await call('/api/records/note/'+privateNote.id)).status,404);
});
