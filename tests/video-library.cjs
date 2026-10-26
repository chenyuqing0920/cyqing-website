// Browser regression for server-relayed library playback and downloads.
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve(__dirname,'..'),browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1200,height:950}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Test transport/disposition independently of platform codecs and social sites.
  const media=Buffer.from('server-relay-fixture-bytes');let jobs=[{id:'ready1',title:'已解析的测试视频',state:'ready',message:'',link:'https://example.test/video'}];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.includes('/relay')){
      requests.push(url.pathname+url.search);const inline=url.searchParams.get('inline')==='1';
      res.writeHead(200,{'Content-Type':'video/webm','Content-Length':media.length,'Content-Disposition':`${inline?'inline':'attachment'}; filename="fixture.webm"`});res.end(media);return;
    }
    if(url.pathname==='/api/session'||url.pathname==='/api/jobs'){
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname.endsWith('session')?{csrf:'test'}:{jobs}));return;
    }
    const file=url.pathname==='/douyin'||url.pathname==='/'?'douyin/web/templates/index.html':url.pathname==='/static/app.js'?'douyin/web/static/app.js':url.pathname==='/static/style.css'?'douyin/web/static/style.css':null;
    if(!file){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(path.join(root,file)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const mount of ['/douyin','/']){
      await page.goto(base+mount);await page.locator('.job-video').waitFor();const prefix=mount==='/'?'':'/douyin';
      assert.equal(await page.locator('.job-video').getAttribute('src'),prefix+'/files/ready1/relay?inline=1');
      await page.locator('.preview-button').click();assert.equal(await page.locator('#preview-video').getAttribute('src'),prefix+'/files/ready1/relay?inline=1');
      assert.equal(await page.locator('#preview-dialog').evaluate(d=>d.open),true);await page.locator('#close-preview').click();
      const wait=page.waitForEvent('download');await page.locator('.save-button').click();const download=await wait;
      assert.deepEqual(await fs.readFile(await download.path()),media);
      await page.locator('.job-video').evaluate(v=>v.dataset.identity='preserved');
      jobs.push({id:'queued',title:'下一条视频',state:'queued',message:'排队中',link:'https://example.test/next'});
      await page.locator('#refresh-button').click();await page.locator('.job[data-state=queued]').waitFor();
      assert.equal(await page.locator('.job-video').getAttribute('data-identity'),'preserved');
      jobs=jobs.filter(j=>j.id!=='queued');
    }
    await page.setViewportSize({width:375,height:812});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),375);
    await fs.mkdir(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/server-video-library.png'),fullPage:true});
    assert.deepEqual(errors,[]);assert(requests.some(r=>r.endsWith('/relay?inline=1')));assert(requests.some(r=>r.endsWith('/relay')));
    console.log('PASS: mounted + standalone server preview routing, download bytes, player preservation, mobile layout');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exit(1)});
