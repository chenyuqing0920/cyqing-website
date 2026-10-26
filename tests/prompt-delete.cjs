const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve(__dirname,'..');
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const asset=url.pathname==='/'?'portal.html':url.pathname.startsWith('/portal-assets/')?url.pathname.slice(15):null;
    if(!['portal.html','app.js','content.js','style.css'].includes(asset)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(path.join(root,'portal',asset)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext();
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/#/prompts');await page.locator('.pcard').first().waitFor();
    assert.equal(await page.locator('[data-delete-builtin]').count(),30);
    const first=page.locator('.pcard').first();
    const name=await first.locator('h3').textContent();
    page.once('dialog',d=>d.dismiss());await first.getByRole('button',{name:'删除',exact:true}).click();assert.equal(await page.locator('.pcard').count(),30);
    page.once('dialog',d=>d.accept());await first.getByRole('button',{name:'删除',exact:true}).click();assert.equal(await page.locator('.pcard').count(),29);
    assert.equal(await page.locator('#prompt-count').textContent(),'29');
    await page.reload();assert.equal(await page.locator('.pcard').count(),29);
    await page.locator('#prompt-search').fill(name);assert.equal(await page.locator('.pcard').count(),0);
    await page.locator('#prompt-search').fill('');
    const other=await context.newPage();await other.goto(base+'/#/prompts');await other.locator('.pcard').first().waitFor();assert.equal(await other.locator('.pcard').count(),29);
    page.once('dialog',d=>d.accept());await page.locator('#prompt-restore-btn').click();
    await other.waitForFunction(()=>document.querySelectorAll('.pcard').length===30);assert.equal(await page.locator('.pcard').count(),30);
    await page.locator('#prompt-add-btn').click();await page.locator('#pf-title').fill('自建删除测试');await page.locator('#pf-text').fill('保留原删除行为');await page.locator('#prompt-form button[type=submit]').click();
    await page.locator('#prompt-search').fill('自建删除测试');
    page.once('dialog',d=>d.accept());await page.locator('[data-delete]').click();assert.equal(await page.locator('.pcard').count(),0);
    await page.locator('#prompt-search').fill('');await page.setViewportSize({width:375,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),375);
    assert.deepEqual(errors,[]);
    console.log('PASS: built-in delete/cancel/persistence/search/count, cross-tab restore, custom delete, mobile');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exit(1)});
