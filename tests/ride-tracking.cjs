const assert = require('node:assert/strict');

// Drive the real Start/Stop controls with deterministic GPS positions.
// Existing IndexedDB records must survive every failed recording unchanged.
module.exports = async function checkRideNotSavedNotice(page, readStored) {
  await page.evaluate(()=>{
    window.__rideTestGps={success:null,error:null,cleared:false};
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      watchPosition(success,error){Object.assign(window.__rideTestGps,{success,error,cleared:false});return 41},
      clearWatch(id){window.__rideTestGps.cleared=id===41}
    }});
    window.tab('trips');
  });
  const before=await readStored(page);
  const start=()=>page.getByRole('button',{name:'Start ride',exact:true}).click();
  const stop=()=>page.getByRole('button',{name:'Stop & save',exact:true}).click();
  const position=async(latitude,accuracy=10)=>page.evaluate(({latitude,accuracy})=>{
    window.__rideTestGps.success({coords:{latitude,longitude:-117,accuracy,speed:0}});
  },{latitude,accuracy});
  const unchanged=async()=>assert.deepEqual(await readStored(page),before,'Unqualified ride must not write records or odometer');
  const msg=page.locator('#msg');

  await start();
  await stop();
  assert.match(await msg.innerText(),/Ride not saved: no usable GPS locations/);
  assert.match(await msg.innerText(),/outdoors/);
  assert.equal(await msg.getAttribute('role'),'status');
  assert.equal(await msg.getAttribute('aria-live'),'polite');
  assert.equal(await page.getByRole('button',{name:'Start ride',exact:true}).count(),1);
  assert.equal(await page.evaluate(()=>window.__rideTestGps.cleared),true);
  await unchanged();

  // Explanations remain readable when returning to Rides.
  await page.evaluate(()=>{window.tab('home');window.tab('trips')});
  assert.match(await msg.innerText(),/Ride not saved/);
  await start();
  assert.doesNotMatch(await msg.innerText(),/Ride not saved/);
  await position(32);
  await position(32.00004); // About 4.4 m: still only one accepted point.
  await stop();
  assert.match(await msg.innerText(),/only one usable GPS location/);
  assert.match(await msg.innerText(),/10 metres \(33 feet\)/);
  await unchanged();

  await start();
  await position(32,80); // Existing accuracy filter ignores this fix.
  await position(32.0002,80);
  await stop();
  assert.match(await msg.innerText(),/no usable GPS locations/);
  await unchanged();

  await start();
  await page.evaluate(()=>window.__rideTestGps.error({code:1}));
  await stop();
  assert.match(await msg.innerText(),/Ride not saved/);
  assert.match(await msg.innerText(),/location access/);
  await unchanged();

  // Two valid points still save in the original trip format.
  await start();
  await page.locator('#tn').fill('GPS save regression');
  await position(32);
  await position(32.0002); // About 22 m.
  await stop();
  assert.doesNotMatch(await msg.innerText(),/Ride not saved/);
  const after=await readStored(page);
  assert.equal(after.trips.length,before.trips.length+1);
  assert.deepEqual(after.trips.slice(0,-1),before.trips);
  const ride=after.trips[after.trips.length-1];
  assert.equal(ride.name,'GPS save regression');
  assert.deepEqual(ride.pts,[[32,-117],[32.0002,-117]]);
  assert(ride.dist>=0.01);
  assert.equal(after.odo,before.odo+ride.dist);
  assert.equal(Object.hasOwn(after,'rideNotice'),false);
  for(const key of ['mods','places','svc','slog','fuel'])assert.deepEqual(after[key],before[key]);
  console.log('Ride notices: no GPS, limited movement, weak GPS, permission denial and normal save passed.');
};
