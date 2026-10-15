// Run against a disposable local origin, never a rider's installed app.
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const fixture = {
  bike:'2019 Yamaha R6',unit:'km',odo:12000,tab:'build',
  mods:[{id:'m1',title:'Exhaust upgrade',cat:'Exhaust',status:'done',cost:200,notes:'Saved build notes',date:1700000000000,photos:['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=']}],
  trips:[{id:'t1',name:'Coastal ride',country:'USA',date:1700000000000,dist:42,dur:3600000,max:70,pts:[[32,-117],[32.01,-117.01]]}],
  places:[{id:'p1',name:'Scenic stop',cat:'Scenic road',country:'USA',coords:'32,-117',addr:'',notes:'Saved place notes'}],
  svc:[{id:'s1',name:'Oil & filter',km:6000,mo:6,lastOdo:10000,lastDate:1700000000000}],
  slog:[{n:'Oil & filter',odo:10000,date:1700000000000}],
  fuel:[{id:'f1',date:1700000000000,odo:12000,l:10,cost:15,cur:'USD',full:true}]
};
async function stored(page){
  return page.evaluate(async()=>{
    const db=await new Promise((res,rej)=>{const r=indexedDB.open('ridegarage',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
    return new Promise(res=>{const q=db.transaction('kv').objectStore('kv').get('s');q.onsuccess=()=>{db.close();res(q.result)}});
  });
}
(async()=>{
 fs.mkdirSync('test-results',{recursive:true});
 for(const [engine,name] of [[chromium,'chromium'],[webkit,'webkit']]){
  const browser=await engine.launch();
  try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(20000);
  console.log(name+': loading fixture');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8080/');
  await page.evaluate(async data=>{
    localStorage.setItem('ride-garage-beta-welcome-v1','1');
    const db=await new Promise((res,rej)=>{const r=indexedDB.open('ridegarage',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
    await new Promise((res,rej)=>{const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(data,'s');tx.oncomplete=res;tx.onerror=rej});db.close();
  },fixture);
  await page.reload();
  await page.locator('#t-home[aria-current="page"]').waitFor();
  assert.match(await page.locator('#v').innerText(),/2019 Yamaha R6/);
  assert.equal(await page.locator('.rg-bike-photo').count(),1);
  console.log(name+': checking responsive routes');
  for(const width of [320,390,768,1024]){
   await page.setViewportSize({width,height:844});
   for(const [tab,text,parent] of [['home','Coastal ride','home'],['build','Exhaust upgrade','build'],['trips','Coastal ride','trips'],['places','Scenic stop','trips'],['profile','Cloud Garage Sync','profile'],['svc','Service history','profile'],['fuel','USD','profile']]){
    await page.evaluate(t=>window.tab(t),tab);
    assert.match(await page.locator('#v').innerText(),new RegExp(text));
    assert.equal(await page.locator('#t-'+parent).getAttribute('aria-current'),'page');
    assert.equal(await page.locator('.tabs button[aria-current="page"]').count(),1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow: '+width+'/'+tab);
    const nav=await page.locator('.tabs').boundingBox();
    assert(Math.abs(nav.y+nav.height-844)<2,'Navigation must stay at bottom');
   }
  }
  assert.deepEqual(await stored(page),fixture,'Browsing must not write or reset records');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#t-home').click();
  await page.screenshot({path:'test-results/'+name+'-home.png',fullPage:true});
  await page.locator('#t-build').click();
  await page.screenshot({path:'test-results/'+name+'-garage.png',fullPage:true});
  await page.getByRole('button',{name:'+ Add build step',exact:true}).click();
  assert.equal(await page.locator('#rg-build-form').evaluate(el=>el.open),true);
  assert.equal(await page.locator('#mt').evaluate(el=>el===document.activeElement),true);
  await page.locator('#rg-build-form > summary').click();
  console.log(name+': verifying editor and backup');
  // Existing editor still saves into the same IndexedDB shape.
  await page.locator('#bk').fill('Yamaha R6 beta');
  await page.locator('#bk').press('Tab');
  await page.waitForFunction(()=>document.getElementById('bike').textContent==='Yamaha R6 beta');
  const saved=await stored(page);assert.equal(saved.bike,'Yamaha R6 beta');
  for(const key of ['mods','trips','places','svc','slog','fuel'])assert.deepEqual(saved[key],fixture[key]);
  await page.evaluate(()=>window.tab('profile'));
  await page.getByText('Backup & restore',{exact:true}).click();
  await page.getByRole('button',{name:'Show backup text',exact:true}).click();
  const exported=JSON.parse(await page.locator('#bt').inputValue());
  assert.deepEqual(exported.mods,fixture.mods);
  assert.deepEqual(exported.trips,fixture.trips);
  page.once('dialog',dialog=>dialog.accept());
  await page.evaluate(data=>applyBk(JSON.stringify(data)),fixture);
  await page.locator('#t-build[aria-current="page"]').waitFor();
  assert.match(await page.locator('#toast').innerText(),/Backup restored and saved/);
  assert.equal(await page.locator('#toast').isVisible(),true);
  assert.deepEqual(await stored(page),fixture);
  console.log(name+': checking offline shell');
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.reload();
  await page.locator('#t-home[aria-current="page"]').waitFor();
  await context.setOffline(true);
  await page.reload();
  await page.locator('#t-home[aria-current="page"]').waitFor();
  await page.locator('#t-build').click();
  assert.match(await page.locator('#v').innerText(),/Exhaust upgrade/);
  assert.equal(errors.length,0,errors.join('\n'));
  } finally { await browser.close(); }
 }
 console.log('Chromium and WebKit: saved records, editors, navigation, responsive layout and offline shell passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
