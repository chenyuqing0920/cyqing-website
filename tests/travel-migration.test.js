import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { prepareTravelBackup } from '../server/travel-backup.js';

test('existing travel records migrate into cities without losing dates, photos or privacy', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../prisma/migrations/20261027125623_initial_sqlite/migration.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO TravelRecord (id,title,city,status,startDate,endDate,latitude,longitude,isPublic,updatedAt) VALUES
      ('trip1','玄武湖','南京','已去',1759276800000,1759363200000,32,118,0,CURRENT_TIMESTAMP),
      ('trip2','夫子庙',' 南京 ','计划中',NULL,1759363200000,NULL,NULL,1,CURRENT_TIMESTAMP),
      ('trip3','旧记录','','想去',NULL,NULL,NULL,NULL,0,CURRENT_TIMESTAMP);
      INSERT INTO MediaAsset (id,filename,originalName,mime,size,width,height) VALUES ('asset1','photo.webp','sample','image/webp',100,10,10);
      INSERT INTO TravelPhoto (id,travelId,assetId,position) VALUES ('photo1','trip1','asset1',0);`);
    db.exec(readFileSync(new URL('../prisma/migrations/20261028000100_travel_cities/migration.sql', import.meta.url), 'utf8'));
    const cities = db.prepare('SELECT * FROM TravelCity ORDER BY name').all();
    assert.equal(cities.length, 2); assert.ok(cities.every(c => /^c[a-z0-9]{24}$/.test(c.id)));
    const trips = db.prepare('SELECT r.*,c.name FROM TravelRecord r JOIN TravelCity c ON c.id=r.cityId ORDER BY r.id').all();
    assert.equal(trips.length, 3); assert.equal(trips[0].name, '南京'); assert.equal(trips[0].cityId, trips[1].cityId);
    assert.equal(trips[0].date, 1759276800000); assert.equal(trips[0].endDate, 1759363200000);
    assert.equal(trips[0].isPublic, 0); assert.equal(trips[1].isPublic, 1); assert.equal(trips[1].status, '想去');
    assert.equal(trips[1].date, 1759363200000); assert.equal(trips[2].name, '未分类');
    assert.equal(db.prepare('SELECT assetId FROM TravelPhoto WHERE travelId=?').get('trip1').assetId, 'asset1');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.throws(() => db.prepare('DELETE FROM TravelCity WHERE id=?').run(trips[0].cityId), /FOREIGN KEY/);
  } finally { db.close(); }
});

test('old backups get city associations while new backups reject missing or duplicate cities', () => {
  const old = {version:1,records:{travel:[{city:'南京',status:'计划中',startDate:'2025-10-01'},{city:' 南京 ',status:'已去',endDate:'2025-10-02'}]}};
  const result = prepareTravelBackup(old);
  assert.equal(result.cities.length,1); assert.equal(result.travel[0].cityId,result.travel[1].cityId);
  assert.equal(result.travel[0].status,'想去'); assert.equal(result.travel[1].date,'2025-10-02');
  assert.equal(old.records.travel[0].cityId,undefined);
  assert.throws(()=>prepareTravelBackup({version:2,cities:[],records:{travel:result.travel}}),/缺失/);
  assert.throws(()=>prepareTravelBackup({version:2,cities:[...result.cities,...result.cities],records:{travel:[]}}),/重复/);
});
