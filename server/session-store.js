import session from 'express-session';
import { db } from './db.js';

// Keep the session in the same persistent SQLite database as the records.
export class PrismaSessionStore extends session.Store {
  constructor(){super();this.timer=setInterval(()=>db.session.deleteMany({where:{expiresAt:{lt:new Date()}}}).catch(()=>{}),60*60*1000);this.timer.unref();}
  get(id,callback){db.session.findUnique({where:{id}}).then(row=>{if(!row||row.expiresAt<=new Date())return callback(null,null);try{return callback(null,JSON.parse(row.data));}catch{return callback(null,null);}}).catch(callback);}
  set(id,value,callback=()=>{}){const expiresAt=value.cookie?.expires?new Date(value.cookie.expires):new Date(Date.now()+12*60*60*1000),data=JSON.stringify(value);db.session.upsert({where:{id},create:{id,data,expiresAt},update:{data,expiresAt}}).then(()=>callback()).catch(callback);}
  destroy(id,callback=()=>{}){db.session.deleteMany({where:{id}}).then(()=>callback()).catch(callback);}
  touch(id,value,callback=()=>{}){const expiresAt=value.cookie?.expires?new Date(value.cookie.expires):new Date(Date.now()+12*60*60*1000);db.session.updateMany({where:{id},data:{expiresAt}}).then(()=>callback()).catch(callback);}
}
