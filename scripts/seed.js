import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const db=new PrismaClient();
try{
  await db.siteConfig.upsert({where:{id:'site'},update:{},create:{id:'site',title:'星光里的生活手帐',subtitle:'把日常收藏成一颗颗星星',bio:'记录路过的风景、喜欢的故事，和每一个平凡的今天。'}});
  if(!(await db.travelRecord.count()))await db.travelRecord.create({data:{title:'示例 · 海边的一天',country:'示例国家',city:'海滨市',place:'日落海岸',status:'已去',startDate:new Date('2025-05-01'),endDate:new Date('2025-05-02'),story:'这是用于体验界面的虚构旅行记录，可以在后台编辑或删除。',tags:['海边','示例'],latitude:24.48,longitude:118.09,isPublic:true}});
  if(!(await db.animeRecord.count()))await db.animeRecord.create({data:{title:'示例 · 星之旅人',tags:['奇幻','示例'],totalEpisodes:12,currentEpisode:5,status:'在看',score:8,review:'这是一条虚构的追番记录。',isPublic:true}});
  if(!(await db.note.count()))await db.note.create({data:{title:'欢迎来到生活手帐',content:'## 写在开始\n\n这是一条示例记录。可以在后台写下日常、整理思绪，也可以将重要内容设为私密。',tags:['生活','示例'],isPublic:true}});
  console.log('示例数据已准备；仅在对应表为空时插入。');
}finally{await db.$disconnect();}
