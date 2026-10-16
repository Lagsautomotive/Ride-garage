const assert = require('node:assert/strict');

// Use the disposable browser-test origin. Language stays outside garage backups.
module.exports = async function checkLanguages(page, readStored) {
  const preferenceKey='ride-garage-language-v1',navigatorKey='__rgLanguageTestNavigator';
  const original=await readStored(page),fixture=JSON.parse(JSON.stringify(original));
  fixture.bike='Home';fixture.mods[0].title='Save build step';fixture.mods[0].notes='Start ride';
  fixture.trips[0].name='Delete';fixture.places[0].name='Show places map';
  const writeStored=data=>page.evaluate(async data=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('ridegarage',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    try{await new Promise((resolve,reject)=>{const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(data,'s');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}
  },data);
  const choose=async language=>{
    await page.locator('[data-rg-language]').first().selectOption(language);
    await page.waitForFunction(language=>document.documentElement.lang===language&&window.RGI18n.language===language,language);
    assert.equal(await page.locator('[data-rg-language]').first().inputValue(),language);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),preferenceKey),language);
  };
  const home=()=>page.locator('#t-home[aria-current="page"]').waitFor();
  const unchanged=async()=>assert.deepEqual(await readStored(page),fixture,'Language must not write or translate garage records');
  const checkPostData=async()=>{
    const data=await page.evaluate(()=>{
      const oldUser=ME;
      try{
        ME={id:'language-test-rider'};
        const host=document.createElement('div');
        host.innerHTML=postCard({id:'language-test-post',user_id:'another-rider',caption:'Delete',bike:'Start ride',image_path:null,created_at:new Date().toISOString(),profiles:{username:'Home'},likes:[{count:0}],comments:[{count:0}]});
        return {caption:host.querySelector('p').textContent,username:host.querySelector('b').textContent,bike:host.querySelector('.mu').textContent};
      }finally{ME=oldUser}
    });
    assert.equal(data.caption,'Delete');assert.equal(data.username,'@Home');assert.match(data.bike,/^Start ride/);
  };
  try{
    assert.equal(await page.evaluate(()=>RGI18n.language),'en');
    await writeStored(fixture);await page.reload();await home();
    await page.locator('#t-build').click();await page.locator('[onclick="openBuildForm()"]').first().click();
    await page.locator('#mt').fill('Stop & save');await page.locator('#mn').fill('Delete my community account');
    await page.locator('#mp').fill('123.45');await page.locator('#ms').selectOption('doing');
    await choose('es-MX');
    assert.match(await page.locator('#t-trips').innerText(),/Rodadas/);
    assert.equal(await page.locator('#mt').inputValue(),'Stop & save');
    assert.equal(await page.locator('#mn').inputValue(),'Delete my community account');
    assert.equal(await page.locator('#mp').inputValue(),'123.45');assert.equal(await page.locator('#ms').inputValue(),'doing');
    assert((await page.locator('.rg-mod-card b').allTextContents()).includes('Save build step'));
    assert.match(await page.locator('#v').innerText(),/Start ride/);
    await checkPostData();await unchanged();
    await page.locator('#t-trips').click();assert.match(await page.locator('#v').innerText(),/Delete/);
    await page.locator('#t-profile').click();await choose('en');
    assert.match(await page.locator('#t-trips').innerText(),/Rides/);assert.match(await page.locator('#v').innerText(),/Ride preferences/);
    await choose('es-MX');await page.reload();await home();
    assert.equal(await page.evaluate(()=>document.documentElement.lang),'es-MX');
    assert.equal(await page.locator('[data-rg-language]').first().inputValue(),'es-MX');
    assert.match(await page.locator('#t-trips').innerText(),/Rodadas/);await unchanged();
    // Switch language in a real web ride without using actual GPS.
    await page.evaluate(()=>{
      window.__languageGps={success:null,error:null,starts:0,clears:[]};
      Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
        watchPosition(success,error){const gps=window.__languageGps;gps.success=success;gps.error=error;gps.starts++;return 91},
        clearWatch(id){window.__languageGps.clears.push(id)}
      }});
      window.tab('trips');
    });
    const start=()=>page.locator('button[onclick="startTrack()"]'),stop=()=>page.locator('button[onclick="stopTrack()"]');
    const position=(latitude,longitude)=>page.evaluate(({latitude,longitude})=>{
      window.__languageGps.success({timestamp:Date.now(),coords:{latitude,longitude,accuracy:5,speed:4}});
    },{latitude,longitude});
    await start().click();await page.locator('#tn').fill('Start ride');await page.locator('#tc').selectOption({index:1});
    const country=await page.locator('#tc').inputValue();
    await position(19.43,-99.13);await position(19.4302,-99.13);
    const active=await page.evaluate(()=>{window.__languageActiveRide=cur;return {pts:cur.pts,dist:cur.dist,startedAt:cur.t0}});
    await choose('en');
    assert.equal(await start().count(),0);assert.equal(await stop().count(),1);
    assert.equal(await page.locator('#tn').inputValue(),'Start ride');assert.equal(await page.locator('#tc').inputValue(),country);
    assert.deepEqual(await page.evaluate(()=>({sameRide:cur===window.__languageActiveRide,pts:cur.pts,dist:cur.dist,startedAt:cur.t0,starts:window.__languageGps.starts,clears:window.__languageGps.clears})),{sameRide:true,...active,starts:1,clears:[]});
    await position(19.4302,-99.1298);await choose('es-MX');
    assert.equal(await page.locator('#tn').inputValue(),'Start ride');assert.equal(await stop().count(),1);
    await stop().click();assert.equal(await start().count(),1);
    const saved=await readStored(page);
    assert.equal(saved.trips.length,fixture.trips.length+1);assert.deepEqual(saved.trips.slice(0,-1),fixture.trips);
    const ride=saved.trips[saved.trips.length-1];
    assert.equal(ride.name,'Start ride');assert.equal(ride.country,country);
    assert.deepEqual(ride.pts,[[19.43,-99.13],[19.4302,-99.13],[19.4302,-99.1298]]);
    assert.deepEqual(await page.evaluate(()=>({starts:window.__languageGps.starts,clears:window.__languageGps.clears})),{starts:1,clears:[91]});
    for(const key of ['bike','unit','mods','places','svc','slog','fuel'])assert.deepEqual(saved[key],fixture[key]);
    await page.goto(new URL('cloud.html',page.url()).href);
    await page.waitForFunction(()=>document.documentElement.lang==='es-MX');
    assert.notEqual(await page.locator('#rgCloudBackup').innerText(),'Download local backup');
    await choose('en');assert.equal(await page.locator('#rgCloudBackup').innerText(),'Download local backup');
    assert.deepEqual(await readStored(page),saved);
    await page.goto(new URL('index.html',page.url()).href);await home();await checkPostData();
    // Device language defaults apply only without an explicit preference.
    await page.addInitScript(key=>{
      const language=sessionStorage.getItem(key);if(!language)return;
      Object.defineProperty(navigator,'language',{configurable:true,get:()=>language});
      Object.defineProperty(navigator,'languages',{configurable:true,get:()=>[language]});
    },navigatorKey);
    await page.evaluate(({navigatorKey,preferenceKey})=>{sessionStorage.setItem(navigatorKey,'es-MX');localStorage.removeItem(preferenceKey)},{navigatorKey,preferenceKey});
    await page.reload();await home();
    assert.equal(await page.evaluate(()=>RGI18n.language),'es-MX');
    assert.match(await page.locator('#t-trips').innerText(),/Rodadas/);
    await choose('en');await page.reload();await home();
    assert.equal(await page.evaluate(()=>navigator.language),'es-MX');assert.equal(await page.evaluate(()=>RGI18n.language),'en');
    await page.evaluate(({navigatorKey,preferenceKey})=>{sessionStorage.setItem(navigatorKey,'en-US');localStorage.removeItem(preferenceKey)},{navigatorKey,preferenceKey});
    await page.reload();await home();assert.equal(await page.evaluate(()=>RGI18n.language),'en');
    assert.deepEqual(await readStored(page),saved);
    console.log('Languages: English/Mexican Spanish, persistence, device default, drafts, rider data, cloud page and active GPS passed.');
  }finally{
    await writeStored(original);
    await page.evaluate(({navigatorKey,preferenceKey})=>{sessionStorage.removeItem(navigatorKey);localStorage.setItem(preferenceKey,'en')},{navigatorKey,preferenceKey});
    await page.reload();await home();
  }
};
