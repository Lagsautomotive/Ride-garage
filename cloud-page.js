/* Cloud Garage Sync page adapter.
 * Shares existing IndexedDB (ridegarage/kv/s) and Supabase Auth session with index.html.
 * No schema upgrades, migrations, auto uploads, or silent local overwrites.
 */
(function(){
  'use strict';
  const tr=(text,params)=>window.RGI18n?RGI18n.t(text,params):text;
  const $=id=>document.getElementById(id);
  const DEFAULT=()=>({mods:[],trips:[],places:[],svc:[],slog:[],fuel:[],odo:0,unit:'km',tab:'build',bike:''});
  let local=DEFAULT(),clientPending=null,scriptPending=null;
  function message(text,params){const el=$('rgCloudStatus');if(el){el.removeAttribute('data-i18n');el._rgI18nStatus={text,params};el.textContent=tr(text,params);}}
  function idb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open('ridegarage',1);
      req.onupgradeneeded=()=>{
        if(!req.result.objectStoreNames.contains('kv'))req.result.createObjectStore('kv');
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||Error('Could not open local garage storage'));
      req.onblocked=()=>reject(Error('Local storage is busy in another tab. Close it and try again.'));
    });
  }
  async function loadStorage(){
    const db=await idb();
    try{
      const stored=await new Promise((resolve,reject)=>{
        const tx=db.transaction('kv','readonly');
        const req=tx.objectStore('kv').get('s');
        req.onsuccess=()=>resolve(req.result);
        req.onerror=()=>reject(req.error||Error('Unable to read saved garage'));
        tx.onerror=()=>reject(tx.error||Error('Unable to read saved garage'));
      });
      if(stored==null)return DEFAULT();
      if(typeof stored!=='object'||Array.isArray(stored)||!Array.isArray(stored.mods)){
        throw Error('Existing garage storage format is unexpected. No data was replaced; restore your downloaded backup or contact support.');
      }
      // Keep all fields exactly as stored, including future custom fields.
      return Object.assign(DEFAULT(),stored);
    }finally{db.close();}
  }
  async function persistStorage(data){
    const db=await idb();
    try{
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('kv','readwrite');
        tx.objectStore('kv').put(JSON.parse(JSON.stringify(data)),'s');
        tx.oncomplete=resolve;
        tx.onerror=()=>reject(tx.error||Error('Unable to save garage'));
        tx.onabort=()=>reject(tx.error||Error('Garage save aborted'));
      });
    }finally{db.close();}
  }
  function validBackup(txt){
    if(typeof txt!=='string'||!txt.trim()||txt.length>50*1024*1024)throw Error('The cloud copy is empty or exceeds 50 MB.');
    const d=JSON.parse(txt);
    if(!d||typeof d!=='object'||Array.isArray(d))throw Error('Invalid garage copy.');
    const fields=['mods','trips','places','svc','slog','fuel'];
    if(!Array.isArray(d.mods))throw Error('Missing motorcycle build records.');
    for(const k of fields){
      if(d[k]!==undefined&&!Array.isArray(d[k]))throw Error('Invalid '+k+' records.');
      if(Array.isArray(d[k])&&!d[k].every(x=>x&&typeof x==='object'&&!Array.isArray(x)))throw Error('Invalid '+k+' item.');
    }
    if(d.unit!==undefined&&!['km','mi'].includes(d.unit))throw Error('Invalid unit.');
    if(d.bike!==undefined&&typeof d.bike!=='string')throw Error('Invalid bike name.');
    if(d.odo!==undefined&&(!Number.isFinite(d.odo)||d.odo<0))throw Error('Invalid odometer.');
    return {mods:d.mods,trips:d.trips||[],places:d.places||[],svc:d.svc||[],
      slog:d.slog||[],fuel:d.fuel||[],odo:d.odo??0,unit:d.unit||'km',bike:d.bike||'',tab:'build'};
  }
  function updateSummary(){
    const counts=['mods','trips','places','svc','fuel'].map(k=>(Array.isArray(local[k])?local[k].length:0));
    const bike=local.bike?local.bike+' · ':'';
    const el=$('rgCloudLocal');if(el){el.removeAttribute('data-i18n');el.textContent=bike+tr('{builds} builds · {trips} trips · {places} places · {service} service items · {fuel} fuel entries',{builds:counts[0],trips:counts[1],places:counts[2],service:counts[3],fuel:counts[4]});}
  }
  async function current(){
    local=await loadStorage();
    updateSummary();
    return local;
  }
  async function backup(){
    const btn=$('rgCloudBackup');
    if(btn)btn.disabled=true;
    try{
      const state=await current();
      const json=JSON.stringify(state);
      const blob=new Blob([json],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;a.download='ride-garage-backup-'+new Date().toISOString().slice(0,10)+'.json';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      message('Backup download requested. Verify the file in your Downloads or Files app before relying on it.');
    }catch(e){message('Backup failed. No records were changed: {error}',{error:tr(e.message||String(e))});}
    finally{if(btn)btn.disabled=false;}
  }
  function loadSDK(){
    if(window.supabase)return Promise.resolve();
    if(scriptPending)return scriptPending;
    scriptPending=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js';
      script.onload=()=>window.supabase?resolve():reject(Error('Supabase script could not start'));
      script.onerror=()=>reject(Error('Could not load sign-in service. Check internet connection.'));
      document.head.appendChild(script);
    }).catch(e=>{scriptPending=null;throw e});
    return scriptPending;
  }
  async function getClient(){
    if(clientPending)return clientPending;
    clientPending=(async()=>{
      const config=window.RG_CONFIG||{};
      if(!config.SUPABASE_URL||!config.SUPABASE_KEY)throw Error('Cloud Sync is not configured.');
      await loadSDK();
      const client=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_KEY);
      client.auth.onAuthStateChange(()=>setTimeout(()=>{
        if(window.RideGarageCloud)window.RideGarageCloud.refreshAuth();
      },0));
      return client;
    })().catch(e=>{clientPending=null;throw e});
    return clientPending;
  }
  async function init(){
    const upload=$('rgCloudUpload'),refresh=$('rgCloudRefresh'),login=$('rgCloudLogin');
    try{
      await current();
      $('rgCloudBackup').disabled=false;
      upload.disabled=false;refresh.disabled=false;login.disabled=false;
      $('rgCloudBackup').addEventListener('click',backup);
      window.RideGarageCloud.init({
        getState:()=>local,
        readState:current,
        setState:data=>{local=data;updateSummary();},
        persist:persistStorage,
        validate:validBackup,
        getClient,
        openSocial:()=>window.location.assign('index.html#social')
      });
      message('Your garage is still saved locally. Choose Save a cloud copy or View cloud copies.');
    }catch(e){
      message('Could not read this device’s garage. No data was changed: {error}',{error:tr(e.message||String(e))});
      const status=$('rgCloudLocal');
      if(status){status.removeAttribute('data-i18n');status.textContent=tr('Existing local storage could not be read safely.');status.setAttribute('data-i18n','Existing local storage could not be read safely.');}
    }
  }
  window.addEventListener('rg-language-change',()=>{const summary=$('rgCloudLocal');if(summary&&!summary.hasAttribute('data-i18n'))updateSummary();const status=$('rgCloudStatus');if(status&&status._rgI18nStatus){const last=status._rgI18nStatus;message(last.text,last.params);}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
  window.addEventListener('pageshow',e=>{if(e.persisted)current().catch(err=>message('Could not refresh garage: {error}',{error:tr(err.message)}));});
})();