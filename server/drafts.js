import { Router } from 'express';
import { db } from './db.js';
import { requireAuth } from './auth.js';
import { schemas,errorMessage } from './validation.js';
export const drafts=Router();
drafts.use(requireAuth);
drafts.get('/:key',async(req,res,next)=>{try{if(!/^(new|c[a-z0-9]{24,})$/.test(req.params.key))return res.status(400).json({error:'草稿标识无效'});const draft=await db.noteDraft.findUnique({where:{key:req.params.key}});res.json(draft||null);}catch(e){next(e);}});
drafts.put('/:key',async(req,res,next)=>{try{if(!/^(new|c[a-z0-9]{24,})$/.test(req.params.key))return res.status(400).json({error:'草稿标识无效'});const parsed=schemas.note.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:errorMessage(parsed.error)});const data={...parsed.data,isPublic:false,isDraft:true};res.json(await db.noteDraft.upsert({where:{key:req.params.key},create:{key:req.params.key,data},update:{data}}));}catch(e){next(e);}});
drafts.delete('/:key',async(req,res,next)=>{try{await db.noteDraft.deleteMany({where:{key:req.params.key}});res.json({ok:true});}catch(e){next(e);}});
