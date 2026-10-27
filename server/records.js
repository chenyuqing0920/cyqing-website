import { Router } from 'express';
import { db } from './db.js';
import { requireAuth } from './auth.js';
import { schemas, errorMessage } from './validation.js';

export const records=Router();
const models={travel:'travelRecord',anime:'animeRecord',note:'note',todo:'todo',countdown:'countdown',bookmark:'bookmark'};
const publicTypes=new Set(['travel','anime','note']);
const include={travel:{photos:{orderBy:{position:'asc'},include:{asset:true}}},anime:{cover:true}};
const selectFields={travel:{id:true,title:true,country:true,province:true,city:true,place:true,startDate:true,endDate:true,status:true,story:true,tags:true,latitude:true,longitude:true,isPublic:true,createdAt:true,updatedAt:true,photos:{orderBy:{position:'asc'},select:{id:true,assetId:true,position:true}}},anime:{id:true,title:true,coverId:true,tags:true,totalEpisodes:true,currentEpisode:true,status:true,startDate:true,endDate:true,score:true,review:true,isPublic:true,createdAt:true,updatedAt:true},note:{id:true,title:true,content:true,tags:true,isPublic:true,isDraft:true,createdAt:true,updatedAt:true}};
const bodyData=(kind,data)=>{if(kind!=='travel')return data;const {photoIds,...rest}=data;return {...rest,photos:{create:photoIds.map((assetId,position)=>({assetId,position}))}};};
function publicWhere(kind,authenticated){return authenticated?{}:kind==='note'?{isPublic:true,isDraft:false}:{isPublic:true};}
records.get('/overview',async(req,res,next)=>{try{
  const authed=!!req.session.userId;
  const [config,travels,anime,notes]=await Promise.all([
    db.siteConfig.findUnique({where:{id:'site'}}),
    db.travelRecord.findMany({where:publicWhere('travel',authed),select:selectFields.travel,orderBy:{updatedAt:'desc'},take:4}),
    db.animeRecord.findMany({where:publicWhere('anime',authed),select:selectFields.anime,orderBy:{updatedAt:'desc'},take:4}),
    db.note.findMany({where:publicWhere('note',authed),select:selectFields.note,orderBy:{updatedAt:'desc'},take:4})]);
  res.json({config:config||{title:'我的数字空间',subtitle:'记录生活，也收藏每一个闪光的瞬间',bio:'欢迎来到我的小小世界。'},travels,anime,notes});
}catch(e){next(e);}});
records.get('/:kind',async(req,res,next)=>{try{
  const kind=req.params.kind,model=models[kind];if(!model)return res.status(404).json({error:'记录类型不存在'});
  const authed=!!req.session.userId;if(!authed&&!publicTypes.has(kind))return res.status(401).json({error:'请先登录'});
  const where=publicTypes.has(kind)?publicWhere(kind,authed):{};
  const q=typeof req.query.q==='string'?req.query.q.trim().slice(0,100):'';
  if(q)where.OR=(kind==='travel'?['title','country','province','city','place','story']:kind==='anime'?['title','review']:kind==='note'?['title','content']:['title']).map(field=>({[field]:{contains:q}}));
  if(typeof req.query.status==='string'&&['travel','anime'].includes(kind))where.status=req.query.status.slice(0,20);
  if(typeof req.query.place==='string'&&kind==='travel')where.AND=[{OR:['country','province','city','place'].map(field=>({[field]:{contains:req.query.place.slice(0,100)}}))}];
  if(typeof req.query.minScore==='string'&&kind==='anime'){const n=Number(req.query.minScore);if(Number.isInteger(n)&&n>=1&&n<=10)where.score={gte:n};}
  const orderBy=req.query.sort==='oldest'?{createdAt:'asc'}:req.query.sort==='score'&&kind==='anime'?{score:'desc'}:kind==='travel'&&req.query.sort==='date'?{startDate:'desc'}:{updatedAt:'desc'};
  let items=await db[model].findMany({where,orderBy,...(publicTypes.has(kind)?{select:selectFields[kind]}:{})});
  if(typeof req.query.tag==='string'&&['travel','anime','note'].includes(kind)){const tag=req.query.tag.slice(0,32);items=items.filter(item=>Array.isArray(item.tags)&&item.tags.includes(tag));}
  res.json({items});
}catch(e){next(e);}});
records.get('/:kind/:id',async(req,res,next)=>{try{
  const kind=req.params.kind,model=models[kind];if(!model)return res.status(404).json({error:'记录类型不存在'});
  if(!req.session.userId&&!publicTypes.has(kind))return res.status(401).json({error:'请先登录'});
  const item=await db[model].findFirst({where:{id:req.params.id,...(publicTypes.has(kind)?publicWhere(kind,!!req.session.userId):{})},...(publicTypes.has(kind)?{select:selectFields[kind]}:{})});
  if(!item)return res.status(404).json({error:'记录不存在'});res.json(item);
}catch(e){next(e);}});
async function validateAssets(kind,data){
  const ids=kind==='travel'?data.photoIds:kind==='anime'&&data.coverId?[data.coverId]:[];
  if(new Set(ids).size!==ids.length)throw Error('图片不能重复');
  if(ids.length&&(await db.mediaAsset.count({where:{id:{in:ids}}}))!==ids.length)throw Error('图片不存在');
}
records.post('/:kind',requireAuth,async(req,res,next)=>{try{
  const kind=req.params.kind,model=models[kind];if(!model)return res.status(404).json({error:'记录类型不存在'});
  const parsed=schemas[kind].safeParse(req.body);if(!parsed.success)return res.status(400).json({error:errorMessage(parsed.error)});
  await validateAssets(kind,parsed.data);const item=await db[model].create({data:bodyData(kind,parsed.data),...(include[kind]?{include:include[kind]}:{})});res.status(201).json(item);
}catch(e){if(e.message==='图片不存在'||e.message==='图片不能重复')return res.status(400).json({error:e.message});next(e);}});
records.put('/:kind/:id',requireAuth,async(req,res,next)=>{try{
  const kind=req.params.kind,model=models[kind];if(!model)return res.status(404).json({error:'记录类型不存在'});
  const parsed=schemas[kind].safeParse(req.body);if(!parsed.success)return res.status(400).json({error:errorMessage(parsed.error)});
  await validateAssets(kind,parsed.data);
  if(!(await db[model].findUnique({where:{id:req.params.id}})))return res.status(404).json({error:'记录不存在'});
  const data=bodyData(kind,parsed.data);if(kind==='travel')data.photos={deleteMany:{},...data.photos};
  const item=await db[model].update({where:{id:req.params.id},data,...(include[kind]?{include:include[kind]}:{})});res.json(item);
}catch(e){if(e.message==='图片不存在'||e.message==='图片不能重复')return res.status(400).json({error:e.message});next(e);}});
records.delete('/:kind/:id',requireAuth,async(req,res,next)=>{try{
  const model=models[req.params.kind];if(!model)return res.status(404).json({error:'记录类型不存在'});
  const deleted=await db[model].deleteMany({where:{id:req.params.id}});if(!deleted.count)return res.status(404).json({error:'记录不存在'});res.json({ok:true});
}catch(e){next(e);}});
