import { Router } from 'express';
import { db } from './db.js';
import { requireAuth } from './auth.js';
import { schemas,errorMessage } from './validation.js';
export const settings=Router();
settings.get('/',requireAuth,async(req,res,next)=>{try{res.json(await db.siteConfig.findUnique({where:{id:'site'}})||{title:'我的数字空间',subtitle:'记录生活，也收藏每一个闪光的瞬间',bio:'欢迎来到我的小小世界。',heroImageId:null});}catch(e){next(e);}});
settings.put('/',requireAuth,async(req,res,next)=>{try{const parsed=schemas.config.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:errorMessage(parsed.error)});if(parsed.data.heroImageId&&!(await db.mediaAsset.findUnique({where:{id:parsed.data.heroImageId}})))return res.status(400).json({error:'背景图片不存在'});res.json(await db.siteConfig.upsert({where:{id:'site'},create:{id:'site',...parsed.data},update:parsed.data}));}catch(e){next(e);}});
