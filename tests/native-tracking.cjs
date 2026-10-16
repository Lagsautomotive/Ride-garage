const assert = require('node:assert/strict');

// Exercise the production native/web boundary on a disposable origin. This mock
// represents an independent native location store: it survives document reloads
// and can collect points while no JavaScript callback runs. Physical-device
// tests are still required to prove Core Location's locked-screen behavior.
module.exports = async function checkNativeTracking(page, readStored) {
  const enabledKey = '__rgNativeTestEnabled';
  const stateKey = '__rgNativeTestState';
  const before = await readStored(page);
  await page.evaluate(({enabledKey,stateKey}) => {
    sessionStorage.setItem(enabledKey,'1');
    sessionStorage.setItem(stateKey,JSON.stringify({
      session:null,calls:{},failAcknowledge:0,browserGeolocation:0
    }));
  },{enabledKey,stateKey});
  await page.addInitScript(({enabledKey,stateKey}) => {
    if(sessionStorage.getItem(enabledKey)!=='1')return;
    const read=()=>JSON.parse(sessionStorage.getItem(stateKey));
    const write=state=>sessionStorage.setItem(stateKey,JSON.stringify(state));
    const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
    const listeners=new Set();
    const count=(state,name)=>{state.calls[name]=(state.calls[name]||0)+1};
    const result=state=>({session:clone(state.session)});
    const plugin={
      async getSession(){
        const state=read();count(state,'getSession');write(state);return result(state);
      },
      async start(metadata={}){
        const state=read();count(state,'start');
        if(state.session)throw Error('An existing native session must be recovered first.');
        state.session={
          id:'browser-native-'+state.calls.start,
          name:metadata.name||'',country:metadata.country||'',
          startedAt:Date.now(),status:'recording',durationMs:0,points:[]
        };
        write(state);return result(state);
      },
      async pause(){
        const state=read();count(state,'pause');state.session.status='paused';
        write(state);return result(state);
      },
      async resume(){
        const state=read();count(state,'resume');state.session.status='recording';
        write(state);return result(state);
      },
      async stop(){
        const state=read();count(state,'stop');state.session.status='stopped';
        state.session.endedAt=Date.now();write(state);return result(state);
      },
      async updateMetadata(metadata={}){
        const state=read();count(state,'updateMetadata');
        if(state.failMetadata){write(state);throw Error('Simulated native metadata write failure.')}
        if(state.session){
          if(metadata.name!==undefined)state.session.name=metadata.name;
          if(metadata.country!==undefined)state.session.country=metadata.country;
        }
        write(state);return result(state);
      },
      async acknowledge({id}){
        const state=read();count(state,'acknowledge');
        if(!state.session||state.session.id!==id)throw Error('Wrong native session acknowledged.');
        if(state.failAcknowledge){
          state.failAcknowledge--;write(state);
          throw Error('Simulated process interruption after the trip committed.');
        }
        state.session=null;write(state);return result(state);
      },
      async addListener(name,callback){
        listeners.add(callback);
        return {remove:async()=>{listeners.delete(callback)}};
      }
    };
    window.__nativeRideTest={
      read,write,
      deliver(patch,{notify=true}={}){
        const state=read();Object.assign(state.session,patch);write(state);
        if(notify)for(const listener of listeners)listener(result(state));
      }
    };
    window.Capacitor={
      isNativePlatform:()=>true,getPlatform:()=> 'ios',
      isPluginAvailable:()=>true,registerPlugin:()=>plugin
    };
    const unexpectedGeolocation=()=>{
      const state=read();state.browserGeolocation++;write(state);
      throw Error('The native app must use its native location recorder.');
    };
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      watchPosition:unexpectedGeolocation,getCurrentPosition:unexpectedGeolocation,
      clearWatch(){}
    }});
    // A failed durable write must leave the native journal available for retry.
    // This fails the real storage API rather than substituting the importer.
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){
      if(window.__nativeTestFailWrite&&this.name==='kv'&&key==='s'){
        throw new DOMException('Simulated full local storage.','QuotaExceededError');
      }
      if(window.__nativeTestConcurrentSave&&this.name==='kv'&&key==='s'&&value.trips?.some(trip=>trip.nativeSessionId)){
        window.__nativeTestConcurrentSave=false;
        queueMicrotask(()=>{window.__nativeTestConcurrentSavePending=window.save()});
      }
      return put.apply(this,arguments);
    };
  },{enabledKey,stateKey});
  const mock=()=>page.evaluate(()=>window.__nativeRideTest.read());
  const start=()=>page.getByRole('button',{name:'Start ride',exact:true}).click();
  const stop=()=>page.getByRole('button',{name:'Stop & save',exact:true}).click();
  const hav=(a,b)=>{
    const r=Math.PI/180,dlat=(b.latitude-a.latitude)*r,dlon=(b.longitude-a.longitude)*r;
    const x=Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlon/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  };
  const distance=points=>points.reduce((sum,p,i)=>
    sum+(i&&p.segment===points[i-1].segment?hav(points[i-1],p):0),0);
  const unchangedGarage=(state,original)=>{
    for(const key of ['bike','unit','mods','places','svc','slog','fuel']){
      assert.deepEqual(state[key],original[key],'Native recording must preserve '+key);
    }
  };
  try {
    await page.reload();
    await page.locator('#t-home[aria-current="page"]').waitFor();
    await page.evaluate(()=>window.tab('trips'));
    await page.getByRole('button',{name:'Start ride',exact:true}).waitFor();
    let native=await mock();
    assert.equal(native.session,null);
    assert.equal(native.calls.start||0,0,'Opening the app must not start location tracking');
    assert.equal(native.browserGeolocation,0);
    assert.deepEqual(await readStored(page),before,'Opening the native recorder must preserve stored records');

    await start();
    await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
    assert.equal((await mock()).session.status,'recording');
    await page.locator('#tn').fill('Native street turns');
    await page.locator('#tc').selectOption({label:'🇺🇸 USA'});
    await page.waitForFunction(()=>{
      const session=window.__nativeRideTest.read().session;
      return session.name==='Native street turns'&&session.country==='🇺🇸 USA';
    });
    const startedAt=(await mock()).session.startedAt;
    // 405 dense points trace two right-angle turns. Every point must survive:
    // the old web downsampling to 400 points must never truncate native rides.
    const first=Array.from({length:405},(_,i)=>({
      latitude:i<135?32+i*.00002:i<270?32+134*.00002:32+(404-i)*.00002,
      longitude:i<135?-117:i<270?-117+(i-134)*.00002:-117+135*.00002,
      timestamp:startedAt+i*1000,accuracy:5+(i%4),speed:5,segment:0
    }));
    // No location event is emitted. Reloading loses all document memory, just
    // as a suspended WebView must reconstruct its view from the native journal.
    await page.evaluate(points=>window.__nativeRideTest.deliver(
      {points,durationMs:405000},{notify:false}
    ),first);
    await page.reload();
    await page.locator('#t-home[aria-current="page"]').waitFor();
    await page.evaluate(()=>window.tab('trips'));
    await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
    assert.equal((await mock()).calls.start,1,'Recovery must not start a second session');
    assert.equal(await page.locator('#tn').inputValue(),'Native street turns');
    assert.equal(await page.locator('#tc').inputValue(),'🇺🇸 USA');
    assert(Number(await page.locator('#ld').innerText())>0,'Recovered locations must restore the live ride');

    await page.getByRole('button',{name:'Pause',exact:true}).click();
    await page.getByRole('button',{name:'Resume',exact:true}).waitFor();
    assert.equal((await mock()).session.status,'paused');
    await page.getByRole('button',{name:'Resume',exact:true}).click();
    await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
    assert.equal((await mock()).session.status,'recording');
    // A deliberately distant second segment detects both odometer inflation
    // and a false straight line across movement while recording was paused.
    const second=[
      {latitude:34,longitude:-119,timestamp:startedAt+450000,accuracy:6,speed:4,segment:1},
      {latitude:34.0002,longitude:-119,timestamp:startedAt+453000,accuracy:7,speed:4,segment:1}
    ];
    const points=first.concat(second);
    await page.evaluate(points=>{
      window.__nativeRideTest.deliver({points,durationMs:408000});
      const state=window.__nativeRideTest.read();
      state.failAcknowledge=1;window.__nativeRideTest.write(state);
      window.__nativeTestConcurrentSave=true;
    },points);
    await stop();
    await page.waitForFunction(()=>window.__nativeRideTest.read().calls.acknowledge===1);
    assert.equal(await page.evaluate(()=>!!window.__nativeTestConcurrentSavePending),true);
    await page.evaluate(()=>window.__nativeTestConcurrentSavePending);
    native=await mock();
    assert.equal(native.session.status,'stopped','Stop must end native recording before import/cleanup');
    assert.equal(native.calls.stop,1);
    assert.equal(native.calls.pause,1);
    assert.equal(native.calls.resume,1);
    const saved=await readStored(page);
    assert.equal(saved.trips.length,before.trips.length+1);
    assert.deepEqual(saved.trips.slice(0,-1),before.trips);
    const ride=saved.trips[saved.trips.length-1];
    assert.equal(ride.id,'native-'+native.session.id);
    assert.equal(ride.nativeSessionId,native.session.id);
    assert.equal(ride.source,'ios-core-location');
    assert.equal(ride.name,'Native street turns');
    assert.equal(ride.country,'🇺🇸 USA');
    assert.equal(ride.date,startedAt);
    assert.equal(ride.dur,408000,'Paused time must not inflate active ride duration');
    assert.equal(ride.max,18);
    assert.deepEqual(ride.gps,points,'Keep timestamp, accuracy, speed and segment for every native fix');
    assert.deepEqual(ride.pts,points.map(p=>[p.latitude,p.longitude]));
    assert.deepEqual(ride.segments,[first,second].map(segment=>segment.map(p=>[p.latitude,p.longitude])));
    assert(Math.abs(ride.dist-distance(points))<0.000001,'Distance must not bridge paused segments');
    assert(Math.abs(saved.odo-(before.odo+ride.dist))<0.000001);
    unchangedGarage(saved,before);
    await page.evaluate(()=>window.tab('trips'));
    assert.equal(await page.locator('#rgTripPreview0 polyline').count(),2,
      'Completed route preview must draw separate segments across a pause');

    // The trip committed but acknowledgement failed. Startup must detect the
    // existing nativeSessionId and clean up without a duplicate trip/odometer.
    await page.reload();
    await page.locator('#t-home[aria-current="page"]').waitFor();
    await page.waitForFunction(()=>{
      const state=window.__nativeRideTest.read();
      return state.session===null&&state.calls.acknowledge===2;
    });
    const recovered=await readStored(page);
    assert.deepEqual(recovered.trips,saved.trips);
    assert.equal(recovered.odo,saved.odo);
    unchangedGarage(recovered,before);
    assert.equal((await mock()).calls.start,1);

    await page.evaluate(()=>window.tab('trips'));
    await start();
    await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
    const retryStart=(await mock()).session.startedAt;
    const retryPoints=[
      {latitude:32,longitude:-117,timestamp:retryStart,accuracy:8,speed:3,segment:0},
      {latitude:32.0002,longitude:-117,timestamp:retryStart+5000,accuracy:9,speed:3,segment:0}
    ];
    await page.evaluate(points=>{
      window.__nativeRideTest.deliver({points,durationMs:5000});
      const state=window.__nativeRideTest.read();state.failMetadata=true;window.__nativeRideTest.write(state);
      window.__nativeTestFailWrite=true;
    },retryPoints);
    await page.locator('#tn').fill('Metadata outage');
    await page.getByRole('button',{name:'Pause',exact:true}).click();
    await page.getByRole('button',{name:'Resume',exact:true}).waitFor();
    assert.equal((await mock()).session.status,'paused');
    await stop();
    await page.getByRole('button',{name:'Retry saving',exact:true}).waitFor();
    native=await mock();
    assert.equal(native.session.status,'stopped');
    assert.equal(native.calls.acknowledge,2,'Failed local persistence must not discard the native journal');
    assert.deepEqual(await readStored(page),recovered,'Failed import must not change durable records');
    assert.match(await page.locator('#msg').innerText(),/sav|stor|retry/i);
    await page.evaluate(()=>{window.__nativeTestFailWrite=false});
    await page.getByRole('button',{name:'Retry saving',exact:true}).click();
    await page.waitForFunction(()=>{
      const state=window.__nativeRideTest.read();
      return state.session===null&&state.calls.acknowledge===3;
    });
    const retried=await readStored(page);
    assert.equal(retried.trips.length,recovered.trips.length+1);
    assert.deepEqual(retried.trips.slice(0,-1),recovered.trips);
    assert.deepEqual(retried.trips[retried.trips.length-1].gps,retryPoints);
    assert(Math.abs(retried.odo-(recovered.odo+distance(retryPoints)))<0.000001);
    unchangedGarage(retried,before);
    native=await mock();
    assert.equal(native.calls.start,2);
    assert.equal(native.calls.stop,2);
    assert.equal(native.browserGeolocation,0);
    console.log('Native rides: explicit start, reload recovery, dense turns, pause segments, idempotent import and storage retry passed.');
  } finally {
    // Leave subsequent backup/offline PWA checks in a real browser environment.
    await page.evaluate(({enabledKey,stateKey})=>{
      sessionStorage.setItem(enabledKey,'0');sessionStorage.removeItem(stateKey);
    },{enabledKey,stateKey});
    await page.reload();
    await page.locator('#t-home[aria-current="page"]').waitFor();
  }
};
