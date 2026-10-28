import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL || '';
if (!url.startsWith('file:') || !path.isAbsolute(url.slice(5))) throw Error('需要绝对路径的 SQLite DATABASE_URL');
const directory = path.join(path.dirname(url.slice(5)), 'backups');
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const file = path.join(directory, 'before-travel-cities-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db');
const db = new PrismaClient();
try {
  // SQLite VACUUM INTO makes a consistent snapshot, including committed WAL data.
  await db.$executeRawUnsafe("VACUUM INTO '" + file.replaceAll("'", "''") + "'");
  await fs.chmod(file, 0o600);
  console.log('数据库备份已保存：' + file);
  console.log('请同时保留 UPLOAD_DIR 内图片；本次城市迁移不会修改图片文件。');
} finally { await db.$disconnect(); }
