import { z } from 'zod';
const text=(max=200)=>z.string().trim().max(max);
const date=z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(`${v}T00:00:00.000Z`);return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===v;},'日期无效'),z.null(),z.literal('')]).optional().transform(v=>v?new Date(`${v}T00:00:00.000Z`):null);
const tags=z.array(text(32)).max(20).default([]);
const optionalNumber=(min,max)=>z.union([z.number().finite().min(min).max(max),z.null()]).optional().transform(v=>v??null);
const publicFlag=z.boolean().default(false);
export const schemas={
  city:z.object({name:text(80).min(1,'请输入城市名称')}),
  travel:z.object({title:text(120).min(1,'请输入景点名称'),cityId:z.string().cuid('请选择城市'),date,status:z.enum(['想去','已去']),story:text(50000).default(''),tags,isPublic:publicFlag,photoIds:z.array(z.string().cuid()).max(30).default([])}),
  anime:z.object({title:text(120).min(1),coverId:z.string().cuid().nullable().optional().default(null),tags,totalEpisodes:z.number().int().min(0).max(10000).default(0),currentEpisode:z.number().int().min(0).max(10000).default(0),status:z.enum(['想看','在看','已看','弃番']),startDate:date,endDate:date,score:z.number().int().min(1).max(10).nullable().optional().default(null),review:text(50000).default(''),isPublic:publicFlag}).refine(x=>!x.totalEpisodes||x.currentEpisode<=x.totalEpisodes,{message:'观看进度不能超过总集数'}).refine(x=>!x.startDate||!x.endDate||x.startDate<=x.endDate,{message:'完成日期不能早于开始日期'}),
  note:z.object({title:text(120).min(1),content:text(100000).default(''),tags,isPublic:publicFlag,isDraft:z.boolean().default(false)}),
  todo:z.object({title:text(300).min(1),done:z.boolean().default(false)}),
  countdown:z.object({title:text(120).min(1),targetDate:date.refine(Boolean,'请选择日期')}),
  bookmark:z.object({title:text(120).min(1),url:z.string().url().max(2048).refine(v=>['http:','https:'].includes(new URL(v).protocol),'仅支持 HTTP/HTTPS 链接'),category:text(80).default('未分类')}),
  config:z.object({title:text(80).min(1),subtitle:text(160),bio:text(500),heroImageId:z.string().cuid().nullable().optional().default(null)})
};
export function errorMessage(error){return error?.issues?.map(x=>x.message).join('；')||'输入不符合要求';}
