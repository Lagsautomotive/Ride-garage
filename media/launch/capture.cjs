const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const root=process.cwd(),out=path.join(root,'media/launch/captures');
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1:8080').pathname;
 const file=path.resolve(root,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
 fs.readFile(file,(error,data)=>{
  if(error){res.writeHead(404).end();return}
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data);
 });
});
(async()=>{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8080,'127.0.0.1',resolve)});
 const browser=await chromium.launch();
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  await context.addInitScript(()=>{try{localStorage.setItem('ride-garage-beta-welcome-v1','1')}catch(e){}});
  await page.goto('http://127.0.0.1:8080/');
  const photo='data:image/png;base64,'+fs.readFileSync('media/launch/hero.png').toString('base64');
  const now=Date.now(),day=86400000;
  const route=[[32.80,-116.91],[32.805,-116.913],[32.81,-116.91],[32.814,-116.902],[32.818,-116.905],[32.822,-116.916],[32.827,-116.919],[32.832,-116.913],[32.837,-116.914],[32.842,-116.923]];
  const demo={
   bike:'Midnight build',unit:'km',odo:18420,tab:'home',
   mods:[
    {id:'demo-m1',title:'Exhaust upgrade',cat:'Exhaust',status:'done',cost:320,notes:'A new sound for the next chapter.',date:now-14*day,photos:[photo]},
    {id:'demo-m2',title:'Brake line refresh',cat:'Brakes',status:'done',cost:150,notes:'Fresh feel at the lever.',date:now-7*day,photos:[]},
    {id:'demo-m3',title:'Suspension setup',cat:'Suspension',status:'doing',cost:250,notes:'Dialing in the ride.',date:now-2*day,photos:[]}
   ],
   trips:[{id:'demo-t1',name:'Sunday switchbacks',country:'USA',date:now-2*day,dist:42.6,dur:56*60000,max:83,pts:route}],
   places:[],svc:[
    {id:'demo-s1',name:'Oil & filter',km:6000,mo:6,lastOdo:17000,lastDate:now-30*day},
    {id:'demo-s2',name:'Chain clean & lube',km:600,mo:0,lastOdo:18380,lastDate:now-3*day},
    {id:'demo-s3',name:'Brake fluid',km:0,mo:24,lastOdo:16000,lastDate:now-90*day}
   ],
   slog:[{n:'Oil & filter',odo:17000,date:now-30*day}],
   fuel:[
    {id:'demo-f1',date:now-5*day,odo:18180,l:12.5,cost:24.5,cur:'USD',full:true},
    {id:'demo-f2',date:now-2*day,odo:18420,l:13,cost:25.8,cur:'USD',full:true}
   ]
  };
  await page.evaluate(async data=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ridegarage',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
   await new Promise((resolve,reject)=>{const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(data,'s');tx.oncomplete=resolve;tx.onerror=reject});db.close();
  },demo);
  await page.reload();await page.locator('#t-home[aria-current="page"]').waitFor();
  async function screen(tab,name){
   await page.evaluate(t=>window.tab(t),tab);
   await page.evaluate(async()=>{await Promise.all([...document.images].map(im=>im.decode().catch(()=>{})))});
   await page.screenshot({path:path.join(out,name+'.png'),animations:'disabled'});
  }
  await screen('home','home');
  await screen('build','garage');
  await page.locator('.rg-mod-card').last().screenshot({path:path.join(out,'mod-card.png'),animations:'disabled'});
  await page.evaluate(()=>{
   Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(success){window.__demoGps=success;return 1},clearWatch(){}}});
   window.tab('trips');window.startTrack();
  });
  await page.locator('#tn').fill('Sunday switchbacks');
  await page.locator('#tc').selectOption({index:1});
  await page.evaluate(points=>{
   cur.t0=Date.now()-23*60000;
   for(const [latitude,longitude] of points)window.__demoGps({coords:{latitude,longitude,accuracy:8,speed:14.7}});
  },route);
  await page.screenshot({path:path.join(out,'rides.png'),animations:'disabled'});
  await screen('svc','service');
  await screen('fuel','fuel');
  await page.locator('#v > .card').first().screenshot({path:path.join(out,'fuel-card.png'),animations:'disabled'});
  console.log('Captured actual app screens on a disposable origin with demo-only records.');
 }finally{
  await browser.close();
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
