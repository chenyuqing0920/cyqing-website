import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { db } from './db.js';

export const auth=Router();
export const requireAuth=(req,res,next)=>req.session?.userId?next():res.status(401).json({error:'请先登录'});
const limiter=rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'尝试次数过多，请稍后再试'}});
auth.get('/session',(req,res)=>res.json({authenticated:!!req.session.userId,csrf:req.session.userId?req.session.csrf:null}));
auth.post('/login',limiter,async(req,res,next)=>{try{
  const {username,password}=req.body||{};
  if(typeof username!=='string'||typeof password!=='string'||username.length>100||password.length>200)return res.status(400).json({error:'请输入用户名和密码'});
  const user=await db.user.findUnique({where:{username}});
  const ok=await bcrypt.compare(password,user?.passwordHash||'$2b$12$C6UzMDM.H6dfI/f/IKcEe.6i7Po8/hoJGWwZgp/5Y/BGMkLZo.v7G');
  if(!user||!ok)return res.status(401).json({error:'用户名或密码不正确'});
  req.session.regenerate(err=>{if(err)return next(err);req.session.userId=user.id;req.session.csrf=crypto.randomBytes(32).toString('hex');req.session.save(err2=>err2?next(err2):res.json({ok:true,csrf:req.session.csrf}));});
}catch(e){next(e);}});
auth.post('/logout',requireAuth,(req,res,next)=>req.session.destroy(err=>{if(err)return next(err);res.clearCookie('space.sid',{path:'/'});res.json({ok:true});}));
export function verifyCsrf(req,res,next){
  if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
  const origin=req.get('origin');
  const allowed=[process.env.PUBLIC_BASE_URL,...(process.env.NODE_ENV==='development'?['http://127.0.0.1:5173','http://localhost:5173']:[])];
  if(origin&&!allowed.includes(origin))return res.status(403).json({error:'请求来源不匹配'});
  if(req.path==='/api/auth/login')return next();
  if(!req.session.userId)return res.status(401).json({error:'请先登录'});
  const token=req.get('x-csrf-token')||'', expected=req.session.csrf||'';
  if(!/^[a-f0-9]{64}$/.test(token)||!/^[a-f0-9]{64}$/.test(expected)||!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(expected)))return res.status(403).json({error:'页面已过期，请刷新后重试'});
  next();
}
