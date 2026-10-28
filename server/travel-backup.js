import crypto from 'node:crypto';
import { schemas } from './validation.js';

// Upgrade v1 exports without changing the caller's backup object.
export function prepareTravelBackup(input) {
  const rows = input.records?.travel;
  if (!Array.isArray(rows) || rows.length > 5000) throw Error('备份旅行记录无效');
  if (input.version === 1) {
    const byName = new Map();
    const travel = rows.map(row => {
      const name = typeof row.city === 'string' && row.city.trim() ? row.city.trim() : '未分类';
      if (!schemas.city.safeParse({ name }).success) throw Error('备份城市数据无效');
      if (!byName.has(name)) byName.set(name, { id: 'c' + crypto.randomBytes(12).toString('hex'), name });
      return { ...row, cityId: byName.get(name).id, date: row.startDate || row.endDate || null,
        status: row.status === '已去' ? '已去' : '想去' };
    });
    return { cities: [...byName.values()], travel };
  }
  if (!Array.isArray(input.cities) || input.cities.length > 5000) throw Error('备份城市数据无效');
  const ids = new Set(), names = new Set();
  const cities = input.cities.map(row => {
    const parsed = schemas.city.safeParse(row);
    if (!parsed.success || typeof row.id !== 'string' || !/^c[a-z0-9]{24,}$/.test(row.id) || ids.has(row.id) || names.has(parsed.data.name))
      throw Error('备份城市数据无效或重复');
    ids.add(row.id); names.add(parsed.data.name);
    return { id: row.id, ...parsed.data };
  });
  if (rows.some(row => !ids.has(row.cityId))) throw Error('备份景点所属城市缺失');
  return { cities, travel: rows };
}
