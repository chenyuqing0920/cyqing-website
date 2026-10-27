import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { db } from './db.js';
import { requireAuth } from './auth.js';
import { uploadDir } from './media.js';
import { schemas } from './validation.js';

export const backup=Router();
const kinds=['travel','anime','note','todo','countdown','bookmark'];
const model={travel:'travelRecord',anime:'animeRecord',note:'note',todo:'todo',countdown:'countdown',bookmark:'bookmark'};
const dateOnly=value=>value?new Date(value).toISOString().slice(0,10):null;
const dateTime=value=>new Date(value);
backup.get('/',requireAuth,async(req,res,next)=>{try{
  const [travel,anime,note,todo,countdown,bookmark,media,config,drafts,tags]=await Promise.all([
    db.travelRecord.findMany({include:{photos:{orderBy:{position:'asc'}}}}),db.animeRecord.findMany(),db.note.findMany(),db.todo.findMany(),db.countdown.findMany(),db.bookmark.findMany(),db.mediaAsset.findMany(),db.siteConfig.findUnique({where:{id:'site'}}),db.noteDraft.findMany(),db.tag.findMany()]);
  const files=[];let total=0;
  for(const item of media){const buffer=await fs.readFile(path.join(uploadDir,item.filename));total+=buffer.length;if(total>80*1024*1024)return res.status(413).json({error:'图片总量超过 80 MB，请使用数据库和上传目录备份'});files.push({id:item.id,originalName:item.originalName,mime:item.mime,width:item.width,height:item.height,data:buffer.toString('base64'),sha256:crypto.createHash('sha256').update(buffer).digest('hex')});}
  const body={format:'digital-space-backup',version:1,createdAt:new Date().toISOString(),records:{travel,anime,note,todo,countdown,bookmark},files,config,drafts,tags};
  res.set('Content-Disposition','attachment; filename="digital-space-backup.json"').set('Cache-Control','no-store').json(body);
}catch(e){next(e);}});

// Restore only authenticated exports. The user and login sessions are intentionally excluded.
// All validation and image verification precede a single database transaction.
backup.post('/restore',requireAuth,async(req,res,next)=>{
  const created=[];
  try{
    const input=req.body;
    if(!input||input.format!=='digital-space-backup'||input.version!==1||!input.records||!Array.isArray(input.files)||input.files.length>1000)throw Error('备份格式不正确');
    const validated={};
    for(const kind of kinds){
      if(!Array.isArray(input.records[kind])||input.records[kind].length>5000)throw Error('备份记录不完整或数量过多');
      validated[kind]=input.records[kind].map(row=>{
        const raw={...row};
        for(const field of ['startDate','endDate','targetDate'])if(field in raw)raw[field]=dateOnly(raw[field]);
        if(kind==='travel')raw.photoIds=(raw.photos||[]).map(p=>p.assetId);
        const parsed=schemas[kind].safeParse(raw);if(!parsed.success||typeof row.id!=='string'||!/^c[a-z0-9]{24,}$/.test(row.id))throw Error('备份含有无效记录');
        if(!Number.isFinite(dateTime(row.createdAt).getTime())||!Number.isFinite(dateTime(row.updatedAt).getTime()))throw Error('备份含有无效日期');
        return {id:row.id,...parsed.data,createdAt:dateTime(row.createdAt),updatedAt:dateTime(row.updatedAt)};
      });
    }
    const sharp=(await import('sharp')).default;const assets=[];const seen=new Set();
    for(const file of input.files){
      if(typeof file.id!=='string'||!/^c[a-z0-9]{24,}$/.test(file.id)||seen.has(file.id)||typeof file.data!=='string'||file.data.length>15*1024*1024||file.mime!=='image/webp')throw Error('备份含有无效图片');
      seen.add(file.id);const bytes=Buffer.from(file.data,'base64');if(!bytes.length||crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('备份图片校验失败');
      const meta=await sharp(bytes,{failOn:'error',limitInputPixels:40_000_000}).metadata();if(meta.format!=='webp'||!meta.width||!meta.height)throw Error('备份图片格式无效');
      const filename=crypto.randomUUID()+'.webp';await fs.writeFile(path.join(uploadDir,filename),bytes,{flag:'wx'});created.push(filename);
      assets.push({id:file.id,filename,originalName:String(file.originalName||'图片').slice(0,200),mime:'image/webp',size:bytes.length,width:meta.width,height:meta.height});
    }
    const config=input.config?schemas.config.parse(input.config):null;
    const savedDrafts=input.drafts||[];if(!Array.isArray(savedDrafts)||savedDrafts.length>5000)throw Error('备份草稿无效');
    for(const draft of savedDrafts){if(!/^(new|c[a-z0-9]{24,})$/.test(draft.key)||!schemas.note.safeParse(draft.data).success)throw Error('备份草稿无效');}
    const savedTags=input.tags||[];if(!Array.isArray(savedTags)||savedTags.length>5000||savedTags.some(t=>typeof t.name!=='string'||!t.name.trim()||t.name.length>32))throw Error('备份标签无效');
    for(const row of validated.travel)if(row.photoIds.some(id=>!seen.has(id)))throw Error('旅行照片缺失');
    for(const row of validated.anime)if(row.coverId&&!seen.has(row.coverId))throw Error('动漫封面缺失');
    if(config?.heroImageId&&!seen.has(config.heroImageId))throw Error('封面图片缺失');
    for(const content of [...validated.note.map(n=>n.content),...savedDrafts.map(d=>d.data.content)])for(const match of content.matchAll(/\/api\/media\/(c[a-z0-9]{24,})/g))if(!seen.has(match[1]))throw Error('笔记图片缺失');
    await db.$transaction(async tx=>{
      await tx.travelPhoto.deleteMany();await tx.travelRecord.deleteMany();await tx.animeRecord.deleteMany();await tx.note.deleteMany();await tx.noteDraft.deleteMany();await tx.tag.deleteMany();await tx.todo.deleteMany();await tx.countdown.deleteMany();await tx.bookmark.deleteMany();await tx.siteConfig.deleteMany();await tx.mediaAsset.deleteMany();
      for(const asset of assets)await tx.mediaAsset.create({data:asset});
      for(const kind of kinds)for(const row of validated[kind]){if(kind==='travel'){const {photoIds,...data}=row;await tx.travelRecord.create({data:{...data,photos:{create:photoIds.map((assetId,position)=>({assetId,position}))}}});}else await tx[model[kind]].create({data:row});}
      if(config)await tx.siteConfig.create({data:{id:'site',...config}});
      for(const draft of savedDrafts)await tx.noteDraft.create({data:{key:draft.key,data:{...draft.data,isPublic:false,isDraft:true}}});
      for(const tag of savedTags)await tx.tag.upsert({where:{name:tag.name.trim()},create:{name:tag.name.trim()},update:{}});
    },{timeout:120000});
    res.json({ok:true,counts:Object.fromEntries(kinds.map(k=>[k,validated[k].length])),images:assets.length});
  }catch(e){for(const filename of created)await fs.unlink(path.join(uploadDir,filename)).catch(()=>{});if(e.code?.startsWith('P')||e.name==='ZodError'||e instanceof RangeError)return res.status(400).json({error:'备份验证失败，原数据库未修改'});if(e.message?.startsWith('备份')||e.message?.includes('缺失'))return res.status(400).json({error:e.message});next(e);}
});
