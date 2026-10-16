const assert=require('node:assert/strict');

module.exports=async function checkRideSpeed(page,readStored){
  await page.evaluate(()=>{
    window.__speedGps={};
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      watchPosition(success,error){window.__speedGps={success,error};return 72},
      clearWatch(){}
    }});
    S.unit='km';window.tab('trips');
  });
  const original=await readStored(page);
  const start=async(name='Speed check')=>{
    await page.getByRole('button',{name:'Start ride',exact:true}).click();
    await page.locator('#tn').fill(name);
  };
  const emit=async(latitude,timestamp,speed=null,accuracy=10)=>page.evaluate(data=>{
    window.__speedGps.success({timestamp:data.timestamp,coords:{latitude:data.latitude,longitude:-117,accuracy:data.accuracy,speed:data.speed}});
  },{latitude,timestamp,speed,accuracy});
  const state=()=>page.evaluate(()=>({max:cur.max,speed:cur.sp,points:cur.pts.length}));
  const stop=()=>page.getByRole('button',{name:'Stop & save',exact:true}).click();
  const closeTo=(actual,expected,tolerance=.2)=>assert(Math.abs(actual-expected)<tolerance,'Expected '+expected+', got '+actual);

  // Sensor speed is optional. GPS sample timestamps, not callback timing,
  // must yield about 40 km/h for 22.24 m in two seconds.
  for(const absent of [null,undefined,NaN,Infinity,-1]){
    await start();
    const at=Date.now();
    await emit(32,at,absent);
    await emit(32.0002,at+2000,absent);
    closeTo((await state()).max,40.03);
    assert.equal(await page.locator('#ls').innerText(),'40');
    await stop();
    closeTo((await readStored(page)).trips.at(-1).max,40.03);
  }

  // Valid native speed, including zero, takes priority over an estimate.
  await start();
  let at=Date.now();
  await emit(32,at,10);
  await emit(32.0002,at+2000,10);
  closeTo((await state()).max,36,.001);
  await stop();
  await start();
  at=Date.now();
  await emit(32,at,0);
  await emit(32.0002,at+2000,0);
  assert.equal((await state()).max,0);
  await stop();

  // Native peaks are not lost just because the route's 10 m gate skips a point.
  await start();
  at=Date.now();
  await emit(32,at,0);
  await emit(32.00002,at+1000,15);
  assert.equal((await state()).points,1);
  assert.equal((await state()).max,54);
  await emit(32.0002,at+2000,5);
  await stop();
  assert.equal((await readStored(page)).trips.at(-1).max,54);

  // With 20 m uncertainty on each fix, keep accumulating the baseline.
  await start();
  at=Date.now();
  for(let i=0;i<=4;i++)await emit(32+i*.0001,at+i*1000,null,20);
  closeTo((await state()).max,40.03);
  await stop();

  // Too-short time intervals must not create artificial high-speed spikes.
  await start();
  at=Date.now();
  await emit(32,at);
  await emit(32.0002,at+100);
  assert.equal((await state()).max,0);
  await emit(32.00022,at+2000);
  closeTo((await state()).max,44.03);
  await stop();

  // Duplicate/backwards timestamps cannot override a real peak, even with
  // a bogus native speed. The next correctly ordered sample can recover.
  await start();
  at=Date.now();
  await emit(32,at);
  await emit(32.0002,at+2000);
  await emit(32.002,at+2000,100);
  await emit(32.00025,undefined); // Invalid timing must not erase the ordering watermark.
  await emit(32.003,at+1000,100);
  closeTo((await state()).max,40.03);
  await emit(32.0004,at+4000);
  await emit(32.0006,at+6000);
  closeTo((await state()).max,40.03);
  await stop();

  // A background/GPS gap is not an instantaneous speed measurement.
  await start();
  at=Date.now();
  await emit(32,at);
  await emit(32.01,at+40000);
  assert.equal((await state()).max,0);
  await emit(32.0102,at+42000);
  closeTo((await state()).max,40.03);
  await stop();

  // Missing sample times cannot be replaced by rapid callback receipt times.
  await start();
  await emit(32,undefined);
  await emit(32.0002,undefined);
  assert.equal((await state()).max,0);
  at=Date.now();
  await emit(32.0004,at);
  await emit(32.0006,at+2000);
  closeTo((await state()).max,40.03);
  await stop();

  const beforeDrift=await readStored(page);
  await start();
  at=Date.now();
  await emit(32,at);
  await emit(32.00002,at+1000);
  await emit(32.00001,at+2000);
  assert.equal((await state()).max,0);
  await emit(32.001,at+3000,100,80); // Weak fix must be ignored entirely.
  assert.equal((await state()).max,0);
  await stop();
  assert.deepEqual(await readStored(page),beforeDrift);

  await start('Speed fallback regression');
  at=Date.now();
  await emit(32,at);
  await emit(32.0002,at+2000);
  await stop();
  let saved=await readStored(page);
  const last=saved.trips.at(-1);
  closeTo(last.max,40.03);
  assert.deepEqual(Object.keys(last).sort(),['id','name','country','date','dist','dur','max','pts'].sort());
  assert.deepEqual(saved.trips.slice(0,original.trips.length),original.trips);
  for(const key of ['mods','places','svc','slog','fuel'])assert.deepEqual(saved[key],original[key]);

  await page.evaluate(()=>{S.unit='mi';save();window.tab('trips')});
  let card=page.locator('#v > .card').filter({hasText:'Speed fallback regression'});
  assert.equal(await card.getByText('25 mph',{exact:true}).count(),1);
  await page.reload();
  await page.locator('#t-home[aria-current="page"]').waitFor();
  await page.evaluate(()=>window.tab('trips'));
  card=page.locator('#v > .card').filter({hasText:'Speed fallback regression'});
  assert.equal(await card.getByText('25 mph',{exact:true}).count(),1);
  saved=await readStored(page);
  closeTo(saved.trips.at(-1).max,40.03);
  console.log('Ride speed: missing sensor values, native readings/zero, baseline accumulation, time guards, jitter, persistence and mph passed.');
};
