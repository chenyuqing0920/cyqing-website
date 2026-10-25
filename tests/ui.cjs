// Run against tests/serve_ui.py. No real passwords or third-party video requests.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const BASE=process.env.UI_BASE||'http://127.0.0.1:18760';
const OUT=path.join(__dirname,'../test-results');
const password='ui-fixture-only';
(async()=>{
  await fs.mkdir(OUT,{recursive:true});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const results=[];
  const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write'],reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{
    if(!localStorage.getItem('ui-seeded')){
      localStorage.setItem('cyqing_my_prompts',JSON.stringify([{id:'legacy-prompt',title:'旧提示词记录',cat:'我的分类',desc:'兼容旧数据',text:'这是原浏览器里的内容',src:'自己写的'}]));
      localStorage.setItem('cyqing_watchlist',JSON.stringify([{id:'legacy-watch',title:'旧观影记录',type:'电影',status:'想看',score:4,note:'保留旧备注',date:'2026-10-20'}]));
      localStorage.setItem('ui-seeded','yes');
    }
  });
  async function go(view){await page.locator(`.nav a[data-page="${view}"]`).click();await page.locator(`[data-view="${view}"]`).waitFor({state:'visible'});}
  await page.goto(BASE,{waitUntil:'networkidle'});
  assert.equal(await page.locator('#prompt-count').textContent(),'31');
  assert.equal(await page.locator('#site-count').textContent(),'5');
  await page.screenshot({path:path.join(OUT,'workspace-desktop.png'),fullPage:true});
  results.push('original 30 prompts + 5 sites retained; legacy local records loaded');
  await go('collection');await page.locator('#site-search').fill('Anime');assert.equal(await page.locator('.site-card').count(),1);
  await go('prompts');
  await page.locator('#prompt-search').fill('旧提示词');assert.equal(await page.locator('.pcard').count(),1);
  await page.locator('.pcard .copy-btn').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'这是原浏览器里的内容');
  await page.locator('#prompt-search').fill('');
  await page.locator('#prompt-add-btn').click();await page.locator('#pf-title').fill('新提示词');await page.locator('#pf-text').fill('测试完整正文');
  await page.locator('#pf-cat').selectOption('__new');await page.locator('#pf-cat-new').fill('新分类');
  await page.locator('#prompt-form button[type=submit]').click();
  await page.locator('#prompt-form').waitFor({state:'hidden'});
  await page.locator('#prompt-search').fill('新提示词');assert.equal(await page.locator('.pcard').count(),1);
  await page.locator('.pcard [data-edit]').click();await page.locator('#pf-desc').fill('已编辑介绍');await page.locator('#prompt-form button[type=submit]').click();
  assert.match(await page.locator('.pcard').innerText(),/已编辑介绍/);
  await page.reload();await page.locator('#prompt-search').fill('新提示词');assert.equal(await page.locator('.pcard').count(),1);
  const exportWait=page.waitForEvent('download');await page.locator('#prompt-export-btn').click();const exported=await exportWait;
  const exportedData=JSON.parse(await fs.readFile(await exported.path(),'utf8'));assert.equal(exportedData.length,2);
  results.push('prompt search/copy/create/edit/reload/export passed');
  const before=await page.evaluate(()=>localStorage.getItem('cyqing_my_prompts'));
  await page.locator('#prompt-import-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{title:'bad-no-text'}]))});
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('导入失败'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('cyqing_my_prompts')),before);
  await page.locator('#prompt-import-file').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{id:'safe-import',title:'导入提示词',text:'导入正文',cat:'测试',src:'原始来源'}]))});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cyqing_my_prompts')).length===3);
  await page.locator('#prompt-search').fill('导入提示词');assert.equal(await page.locator('.pcard').count(),1);
  page.once('dialog',d=>d.accept());await page.locator('.pcard [data-delete]').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('cyqing_my_prompts')).length),2);
  results.push('prompt import validation preserves existing data; valid import/delete passed');
  await go('watch');assert.match(await page.locator('#watch-grid').innerText(),/旧观影记录/);
  await page.locator('[data-next="legacy-watch"]').click();assert.match(await page.locator('#watch-grid').innerText(),/在看/);
  await page.locator('#watch-add-btn').click();await page.locator('#wf-title').fill('新的观影记录');await page.locator('#wf-note').fill('新记录备注');await page.locator('#wf-score').selectOption('5');await page.locator('#watch-form button[type=submit]').click();
  await page.locator('#watch-search').fill('新的观影');assert.equal(await page.locator('.watch-card').count(),1);
  await page.locator('.watch-card [data-watch-edit]').click();await page.locator('#wf-status').selectOption('已看');await page.locator('#watch-form button[type=submit]').click();assert.match(await page.locator('.watch-card').innerText(),/已看/);
  const watchExport=page.waitForEvent('download');await page.locator('#watch-export-btn').click();assert.equal(JSON.parse(await fs.readFile(await (await watchExport).path(),'utf8')).length,2);
  page.once('dialog',d=>d.accept());await page.locator('.watch-card [data-watch-delete]').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('cyqing_watchlist')).length),1);
  await page.locator('#watch-import-file').setInputFiles({name:'watch.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{id:'imported-watch',title:'导入的观影记录',type:'电影',status:'已看',score:99,note:'导入备注'}]))});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cyqing_watchlist')).length===2);
  await page.locator('#watch-search').fill('导入的观影');assert.equal(await page.locator('.watch-card').count(),1);
  assert.match(await page.locator('.watch-card').innerText(),/★★★★★/);
  const watchBefore=await page.evaluate(()=>localStorage.getItem('cyqing_watchlist'));
  await page.locator('#watch-import-file').setInputFiles({name:'invalid-watch.json',mimeType:'application/json',buffer:Buffer.from('[{"missing":"title"}]')});
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('导入失败'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('cyqing_watchlist')),watchBefore);
  results.push('watch legacy/create/edit/state/search/export/delete passed');

  await go('video');const video=page.frameLocator('#video-frame');
  await video.locator('#password').fill(password);await video.locator('#login-button').click();await video.locator('#workspace').waitFor({state:'visible'});
  await video.locator('#share-text').fill('https://www.douyin.com/video/123');
  await video.locator('#submit-button').click();await video.locator('.job[data-state=ready]').first().waitFor();
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('正在解析'));
  assert.equal(await video.locator('#notice').isVisible(),false);
  const sourceLink=await video.locator('.job-secondary a').first().getAttribute('href');assert.match(sourceLink,/^\/douyin\/files\//);
  await video.locator('#share-text').fill('切换导航后仍保留的内容');
  const child=page.frames().find(f=>f.url().includes('/douyin'));await child.evaluate(()=>window.uiPreserved=true);
  await go('prompts');await go('video');assert.equal(await video.locator('#share-text').inputValue(),'切换导航后仍保留的内容');assert.equal(await child.evaluate(()=>window.uiPreserved),true);
  assert.equal(await video.locator('.standalone-header').isVisible(),false);
  // A long history must not center an embedded modal thousands of pixels down.
  await child.evaluate(()=>{const spacer=document.createElement('div');spacer.id='modal-long-history-fixture';spacer.style.height='5000px';document.querySelector('main').append(spacer);});
  await page.waitForFunction(()=>document.querySelector('#video-frame').getBoundingClientRect().height>5000);
  const scrollBeforeDialog=await page.evaluate(()=>scrollY);
  await video.locator('#log-button').click();assert.equal(await video.locator('#log-dialog').evaluate(el=>el.open),true);
  await page.waitForFunction(()=>{const f=document.querySelector('#video-frame'),r=f.getBoundingClientRect(),d=f.contentDocument.querySelector('#log-dialog').getBoundingClientRect();return r.top+d.top>=0&&r.top+d.bottom<=innerHeight;});
  assert.ok(Math.abs(await page.evaluate(()=>scrollY)-scrollBeforeDialog)<300,'opening a modal should not jump down the long tool document');
  await video.locator('#close-log').click();
  await child.evaluate(()=>document.querySelector('#modal-long-history-fixture').remove());
  await page.screenshot({path:path.join(OUT,'video-desktop.png'),fullPage:true});
  results.push('embedded video login/CSRF/simulated parsing/preview prefix/logs/state preservation passed');

  await go('files');const files=page.frameLocator('#files-frame');
  await files.locator('#password').fill(password);await files.getByRole('button',{name:'进入文件小站'}).click();
  await files.locator('#upload-form').waitFor();
  const filename='测试文档-'+Date.now()+'.txt';
  await files.locator('#file-input').setInputFiles({name:filename,mimeType:'text/plain',buffer:Buffer.from('file upload and download verified')});
  await files.locator('#upload-button').click();await files.locator('.file-row').filter({hasText:filename}).waitFor();
  const row=files.locator('.file-row').filter({hasText:filename});
  const fileDownload=page.waitForEvent('download');await row.locator('a.download').click();const actual=await fileDownload;
  assert.equal(await fs.readFile(await actual.path(),'utf8'),'file upload and download verified');
  const cookies=await context.cookies();assert(cookies.some(c=>c.name==='session'));assert(cookies.some(c=>c.name==='douyin_remote_session'));
  assert.equal(await files.locator('.standalone-nav').isVisible(),false);
  await page.screenshot({path:path.join(OUT,'files-desktop.png'),fullPage:true});
  page.once('dialog',d=>d.accept());await row.locator('button.delete').click();await row.waitFor({state:'detached'});
  assert.equal(page.url(),BASE+'/#/files');
  await go('video');assert.equal(await video.locator('#workspace').isVisible(),true);
  results.push('real isolated file login/upload/download/content/delete/session coexistence passed');

  for(const width of [1440,375]){
    await page.setViewportSize({width,height:width===375?812:1000});
    for(const view of ['home','collection','prompts','watch','video','files']){
      await go(view);await page.waitForTimeout(150);
      const measure=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.equal(measure.scroll,measure.width,`overflow ${view} ${width}`);
      if(['video','files'].includes(view)){
        const f=page.frames().find(f=>f.url().includes(view==='video'?'/douyin':'/files/'));
        const childSize=await f.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.equal(childSize.scroll,childSize.width,`tool overflow ${view} ${width}`);
      }
      if(width===375)await page.screenshot({path:path.join(OUT,view+'-mobile.png'),fullPage:true});
    }
  }
  const duplicateIds=await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.filter((id,i)=>ids.indexOf(id)!==i)});assert.deepEqual(duplicateIds,[]);
  assert.deepEqual(errors,[]);
  results.push('all 6 views at 1440px and 375px: no overflow, no duplicate IDs or JavaScript errors');

  // Malformed old data is never silently replaced, and can still be exported.
  const corrupt=await browser.newContext();const corruptPage=await corrupt.newPage();
  await corrupt.addInitScript(()=>localStorage.setItem('cyqing_my_prompts','{broken original data'));
  await corruptPage.goto(BASE+'/#/prompts');await corruptPage.locator('#prompt-add-btn').click();await corruptPage.locator('#pf-title').fill('must not overwrite');await corruptPage.locator('#pf-text').fill('body');await corruptPage.locator('#prompt-form button[type=submit]').click();
  assert.equal(await corruptPage.evaluate(()=>localStorage.getItem('cyqing_my_prompts')),'{broken original data');
  const rawDownload=corruptPage.waitForEvent('download');await corruptPage.locator('#prompt-export-btn').click();assert.equal(await fs.readFile(await (await rawDownload).path(),'utf8'),'{broken original data');
  results.push('malformed legacy storage preserved and raw backup export passed');
  await corrupt.close();await context.close();await browser.close();
  await fs.writeFile(path.join(OUT,'ui-verification.json'),JSON.stringify({passed:true,results,errors},null,2));
  console.log(JSON.stringify({passed:true,results,errors},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
