import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { Router } from 'express';
import { db } from './db.js';
import { requireAuth,isAuthed } from './auth.js';

export const uploadDir=path.resolve(process.env.UPLOAD_DIR||'./uploads');
await fs.mkdir(uploadDir,{recursive:true});
export const media=Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1}});
media.get('/',requireAuth,async(req,res,next)=>{try{res.json({items:await db.mediaAsset.findMany({orderBy:{createdAt:'desc'},take:500})});}catch(e){next(e);}});
media.post('/',requireAuth,upload.single('image'),async(req,res,next)=>{try{
  if(!req.file)return res.status(400).json({error:'请选择图片'});
  const img=sharp(req.file.buffer,{failOn:'error',limitInputPixels:40_000_000});
  const metadata=await img.metadata();
  if(!['jpeg','png','webp','gif'].includes(metadata.format)||!metadata.width||!metadata.height)return res.status(400).json({error:'仅支持 JPEG、PNG、WebP 或 GIF 图片'});
  const data=await img.rotate().webp({quality:90}).toBuffer({resolveWithObject:true});
  const filename=crypto.randomUUID()+'.webp';
  await fs.writeFile(path.join(uploadDir,filename),data.data,{flag:'wx'});
  try{const item=await db.mediaAsset.create({data:{filename,originalName:req.file.originalname.slice(0,200),mime:'image/webp',size:data.data.length,width:data.info.width,height:data.info.height}});res.status(201).json({id:item.id,url:'/api/media/'+item.id,width:item.width,height:item.height});}catch(e){await fs.unlink(path.join(uploadDir,filename)).catch(()=>{});throw e;}
}catch(e){if(e instanceof multer.MulterError||/unsupported image|Input buffer|pixel limit/i.test(e.message))return res.status(400).json({error:'图片无效或超过大小限制'});next(e);}});
media.get('/:id',async(req,res,next)=>{try{
  const asset=await db.mediaAsset.findUnique({where:{id:req.params.id},include:{travelPhotos:{include:{travel:{select:{isPublic:true}}}},animeCovers:{select:{isPublic:true}},heroFor:{select:{id:true}}}});
  if(!asset)return res.status(404).end();
  if(!isAuthed(req)){
    const publicNote=await db.note.findFirst({where:{isPublic:true,isDraft:false,content:{contains:'/api/media/'+asset.id}},select:{id:true}});
    if(!asset.heroFor.length&&!asset.travelPhotos.some(p=>p.travel.isPublic)&&!asset.animeCovers.some(a=>a.isPublic)&&!publicNote)return res.status(404).end();
  }
  res.type(asset.mime).set('X-Content-Type-Options','nosniff').set('Cache-Control','private, no-store');
  res.sendFile(path.join(uploadDir,asset.filename),err=>{if(err&&!res.headersSent)res.status(404).end();});
}catch(e){next(e);}});
media.delete('/:id',requireAuth,async(req,res,next)=>{try{
  const asset=await db.mediaAsset.findUnique({where:{id:req.params.id},include:{travelPhotos:true,animeCovers:true,heroFor:true}});
  if(!asset)return res.status(404).json({error:'图片不存在'});
  const noteUse=await db.note.count({where:{content:{contains:'/api/media/'+asset.id}}});
  const draftUse=(await db.noteDraft.findMany({select:{data:true}})).some(d=>typeof d.data?.content==='string'&&d.data.content.includes('/api/media/'+asset.id));
  if(asset.travelPhotos.length||asset.animeCovers.length||asset.heroFor.length||noteUse||draftUse)return res.status(409).json({error:'图片仍被记录或草稿使用，请先移除引用'});
  await db.mediaAsset.delete({where:{id:asset.id}});await fs.unlink(path.join(uploadDir,asset.filename)).catch(()=>{});res.json({ok:true});
}catch(e){next(e);}});
