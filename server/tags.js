import { Router } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { requireAuth } from './auth.js';
export const tags=Router();
tags.use(requireAuth);
const nameSchema=z.string().trim().min(1).max(32);
tags.get('/',async(req,res,next)=>{try{const [saved,travels,anime,notes]=await Promise.all([db.tag.findMany(),db.travelRecord.findMany({select:{tags:true}}),db.animeRecord.findMany({select:{tags:true}}),db.note.findMany({select:{tags:true}})]);const names=new Set([...saved.map(t=>t.name),...[...travels,...anime,...notes].flatMap(x=>x.tags)]);res.json({items:[...names].sort((a,b)=>a.localeCompare(b,'zh-CN'))});}catch(e){next(e);}});
tags.post('/',async(req,res,next)=>{try{const parsed=nameSchema.safeParse(req.body?.name);if(!parsed.success)return res.status(400).json({error:'标签需要 1–32 个字符'});await db.tag.upsert({where:{name:parsed.data},create:{name:parsed.data},update:{}});res.status(201).json({ok:true});}catch(e){next(e);}});
async function mutate(name,replacement){
  await db.$transaction(async tx=>{
    for(const model of ['travelRecord','animeRecord','note']){
      const rows=await tx[model].findMany({select:{id:true,tags:true}});
      for(const row of rows){if(!Array.isArray(row.tags)||!row.tags.includes(name))continue;const next=[...new Set(row.tags.flatMap(t=>t===name?(replacement?[replacement]:[]):[t]))];await tx[model].update({where:{id:row.id},data:{tags:next}});}
    }
    const drafts=await tx.noteDraft.findMany();for(const draft of drafts){if(!Array.isArray(draft.data?.tags)||!draft.data.tags.includes(name))continue;const next=[...new Set(draft.data.tags.flatMap(t=>t===name?(replacement?[replacement]:[]):[t]))];await tx.noteDraft.update({where:{key:draft.key},data:{data:{...draft.data,tags:next}}});}
    await tx.tag.deleteMany({where:{name}});
    if(replacement)await tx.tag.upsert({where:{name:replacement},create:{name:replacement},update:{}});
  });
}
tags.put('/:name',async(req,res,next)=>{try{const old=nameSchema.safeParse(req.params.name),nextName=nameSchema.safeParse(req.body?.name);if(!old.success||!nextName.success)return res.status(400).json({error:'标签需要 1–32 个字符'});if(old.data!==nextName.data)await mutate(old.data,nextName.data);res.json({ok:true});}catch(e){next(e);}});
tags.delete('/:name',async(req,res,next)=>{try{const parsed=nameSchema.safeParse(req.params.name);if(!parsed.success)return res.status(400).json({error:'标签无效'});await mutate(parsed.data,null);res.json({ok:true});}catch(e){next(e);}});
