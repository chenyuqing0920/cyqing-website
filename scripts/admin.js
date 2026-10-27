import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
const db=new PrismaClient();
try{
  if(await db.user.count())throw Error('管理员已存在，未更改账号。');
  const username=process.env.ADMIN_USERNAME||'admin';
  const stdinPassword=process.argv.includes('--password-stdin')?(await new Promise((resolve,reject)=>{let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>resolve(text.replace(/[\r\n]+$/,'')));process.stdin.on('error',reject);})):'';
  const generated=!process.env.ADMIN_PASSWORD&&!stdinPassword;
  const password=process.env.ADMIN_PASSWORD||stdinPassword||crypto.randomBytes(18).toString('base64url');
  if(username.length<3||password.length<12)throw Error('用户名至少 3 位、密码至少 12 位');
  let file=null, encryptedPassword=null;
  if(generated){
    if(process.platform!=='win32')throw Error('请通过 ADMIN_PASSWORD 或 --password-stdin 提供管理员密码；不会将明文写入文件。');
    const encrypted=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','$p=[Console]::In.ReadToEnd(); ConvertTo-SecureString -String $p -AsPlainText -Force | ConvertFrom-SecureString'],{input:password,encoding:'utf8',windowsHide:true});
    if(encrypted.status!==0||!encrypted.stdout.trim())throw Error('无法使用 Windows DPAPI 加密初始密码');
    encryptedPassword=encrypted.stdout.trim();file=path.resolve('data/admin-access.json');await fs.mkdir(path.dirname(file),{recursive:true});
  }
  await db.$transaction(async tx=>{
    await tx.user.create({data:{username,passwordHash:await bcrypt.hash(password,12)}});
    if(file)await fs.writeFile(file,JSON.stringify({username,encryptedPassword}),{mode:0o600,flag:'wx'});
  });
  if(file)console.log(`已生成 Windows 加密凭据：${file}；使用 scripts/show-admin-password.ps1 查看。`);
  console.log('管理员创建完成。');
}catch(e){console.error(e.message);process.exitCode=1;}finally{await db.$disconnect();}
