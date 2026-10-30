import { Router } from 'express';
import { db } from './db.js';
import { requireAuth,isAuthed } from './auth.js';
import { schemas, errorMessage } from './validation.js';

export const cities = Router();
// Empty cities and private-only cities are visible only to the owner.
cities.get('/', async (req, res, next) => {
  try {
    const visible = isAuthed(req) ? {} : { isPublic: true };
    const items = await db.travelCity.findMany({
      where: isAuthed(req) ? {} : { records: { some: visible } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, records: { where: visible, orderBy: { updatedAt: 'desc' },
        select: { status: true, photos: { orderBy: { position: 'asc' }, take: 1, select: { assetId: true } } } } }
    });
    res.set('Cache-Control', 'private, no-store').json({ items: items.map(({ records, ...city }) => ({
      ...city, count: records.length, visited: records.filter(r => r.status === '已去').length,
      coverId: records.find(r => r.photos.length)?.photos[0].assetId || null
    })) });
  } catch (e) { next(e); }
});
for (const method of ['post', 'put']) cities[method](method === 'post' ? '/' : '/:id', requireAuth, async (req, res, next) => {
  const parsed = schemas.city.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: errorMessage(parsed.error) });
  try {
    const item = method === 'post' ? await db.travelCity.create({ data: parsed.data }) :
      await db.travelCity.update({ where: { id: req.params.id }, data: parsed.data });
    res.status(method === 'post' ? 201 : 200).json(item);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: '这个城市已经存在，请直接选择它添加景点' });
    if (e.code === 'P2025') return res.status(404).json({ error: '城市不存在' });
    next(e);
  }
});
cities.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    if (await db.travelRecord.count({ where: { cityId: req.params.id } }))
      return res.status(409).json({ error: '城市下还有景点，请先移动或删除景点' });
    const deleted = await db.travelCity.deleteMany({ where: { id: req.params.id } });
    if (!deleted.count) return res.status(404).json({ error: '城市不存在' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2003') return res.status(409).json({ error: '城市下还有景点，不能删除' });
    next(e);
  }
});
