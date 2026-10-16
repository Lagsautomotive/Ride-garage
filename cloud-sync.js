/* Ride Garage Cloud Sync beta: explicit, private, append-only snapshots.
 * Never pushes automatically, clears local data, or changes existing backup/restore.
 */
(function(){
  'use strict';
  const tr=(text,params)=>window.RGI18n?RGI18n.t(text,params):text;
  const KEYS=['mods','trips','places','svc','slog','fuel'];
  const MAX_BYTES=7800000; // allow room under the server's 8 MB JSONB limit
  let api=null,busy=false,saved=[],listed=false,authChecked=false,currentUser=null;
  const $=id=>document.getElementById(id);
  const copy=x=>JSON.parse(JSON.stringify(x));
  // Postgres JSONB can reorder object keys; compare canonical JSON to avoid false conflicts.
  const stable=x=>JSON.stringify(x,(key,value)=>{
    if(value&&typeof value==='object'&&!Array.isArray(value)){
      const sorted={};Object.keys(value).sort().forEach(k=>{sorted[k]=value[k]});return sorted;
    }
    return value;
  });
  const html=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const size=x=>new TextEncoder().encode(JSON.stringify(x)).length;
  function status(message,params){const el=$('rgCloudStatus');if(el){el.removeAttribute('data-i18n');el._rgI18nStatus={text:message,params};el.textContent=tr(message,params);}}
  function setBusy(value){
    busy=value;
    ['rgCloudUpload','rgCloudRefresh'].forEach(id=>{const el=$(id);if(el)el.disabled=value});
    const box=$('rgCloudCopies');
    if(box)box.querySelectorAll('button').forEach(b=>{b.disabled=value});
  }
  function snapshot(x){
    const result={};
    KEYS.forEach(k=>{result[k]=copy(Array.isArray(x[k])?x[k]:[])});
    result.bike=typeof x.bike==='string'?x.bike:'';
    result.odo=Number.isFinite(x.odo)?x.odo:0;
    result.unit=x.unit==='mi'?'mi':'km';
    return result;
  }
  function counts(s){
    const r={};KEYS.forEach(k=>{r[k]=Array.isArray(s[k])?s[k].length:0});return r;
  }
  function describe(c){return tr('Builds {builds} · Trips {trips} · Places {places} · Service {service} · Fuel {fuel}',{builds:c.mods||0,trips:c.trips||0,places:c.places||0,service:c.svc||0,fuel:c.fuel||0});}
  async function auth(){
    if(!api)throw Error('Cloud Sync is not ready yet.');
    const client=await api.getClient();
    const {data,error}=await client.auth.getUser();
    if(error)throw error;
    const user=data&&data.user;
    if(!user)throw Error('Sign in on the Social tab first. Then return here to save or restore cloud copies.');
    return {client,user};
  }
  function clearList(){saved=[];listed=false;const e=$('rgCloudCopies');if(e)e.innerHTML='';}
  function renderAuth(){const box=$('rgCloudAuth');if(!box||!authChecked)return;box.removeAttribute('data-i18n');box.textContent=currentUser?tr('Signed in as {account}. Cloud copies are private to this account.',{account:currentUser.email||tr('your rider account')}):tr('Not signed in. Use the Social tab to sign in or create an account.');}
  async function refreshAuth(){
    const box=$('rgCloudAuth');
    if(!box||!api)return;
    try{
      const {user}=await auth();
      currentUser=user;authChecked=true;renderAuth();
    }catch(e){
      currentUser=null;authChecked=true;renderAuth();
      clearList();
    }
  }
  function makeList(rows){
    saved=rows||[];listed=true;
    const el=$('rgCloudCopies');if(!el)return;
    if(!saved.length){el.innerHTML='<p class="mu">'+html(tr('No cloud copies yet. Save your garage from this device first.'))+'</p>';return}
    el.innerHTML='<p class="mu">'+html(tr('Your 10 newest private cloud copies (newest first):'))+'</p>'+ 
      saved.map(r=>{
        const date=new Date(r.created_at).toLocaleString(window.RGI18n?RGI18n.locale:undefined);
        return '<div class="rg-cloud-copy"><div><b>'+html(date)+'</b><div class="mu">'+html(describe(r.summary||{}))+' · '+Math.ceil((r.byte_size||0)/1024)+' KB</div></div>'+
          '<button type="button" class="btn alt sm" data-cloud-id="'+html(r.id)+'">'+html(tr('Merge into this device'))+'</button></div>';
      }).join('');
    el.querySelectorAll('button[data-cloud-id]').forEach(b=>{
      b.addEventListener('click',()=>mergeFromCloud(b.getAttribute('data-cloud-id')));
    });
  }
  async function listCloud(){
    if(busy)return;
    setBusy(true);
    status('Checking your private cloud copies…');
    try{
      const {client,user}=await auth();
      const {data,error}=await client.from('ride_garage_cloud_snapshots')
        .select('id,created_at,summary,byte_size').eq('user_id',user.id)
        .order('created_at',{ascending:false}).limit(10);
      if(error)throw error;
      makeList(data||[]);
      status('Cloud copies loaded. Your local garage has not been changed.');
      await refreshAuth();
    }catch(e){status('Could not load cloud copies: {error}',{error:tr(e.message||String(e))})}
    finally{setBusy(false)}
  }
  async function upload(){
    if(busy)return;
    setBusy(true);
    try{
      const {client,user}=await auth();
      const source=api.readState?await api.readState():api.getState();
      const garage=snapshot(source),json=JSON.stringify(garage);
      const bytes=new TextEncoder().encode(json).length;
      if(bytes>MAX_BYTES)throw Error(tr('Your garage is {size} MB, over the cloud beta limit. Your photos are safe locally. Use Download backup file until larger uploads are supported.',{size:Math.ceil(bytes/1024/1024)}));
      const ok=confirm(tr('Create a PRIVATE cloud copy of this device\'s garage?\n\nThis includes motorcycle records, maintenance, fuel, GPS trip points, saved places and embedded photos. It stays tied to your signed-in account.\n\nThis does not delete or replace anything on your device.'));
      if(!ok){status('Upload cancelled. Your garage was not changed.');return}
      status('Uploading a private garage copy…');
      const {error}=await client.from('ride_garage_cloud_snapshots')
        .insert({user_id:user.id,garage,summary:counts(garage),byte_size:bytes});
      if(error)throw error;
      status('Private cloud copy saved. Local data was not changed.');
    }catch(e){status('Cloud upload failed (local garage is unchanged): {error}',{error:tr(e.message||String(e))})}
    finally{setBusy(false)}
    await listCloud();
  }
  function mergeGarages(local,remote,snapshotId){
    const output=copy(local);
    const stats={added:0,conflicts:0};
    KEYS.forEach(key=>{
      const own=Array.isArray(output[key])?output[key]:[];
      const incoming=Array.isArray(remote[key])?remote[key]:[];
      const ids=new Map();
      own.forEach(item=>{if(item.id!=null)ids.set(String(item.id),item)});
      const noIds=new Set(own.map(item=>stable(item)));
      incoming.forEach((item,i)=>{
        const raw=stable(item);
        if(noIds.has(raw))return;
        const id=item.id==null?null:String(item.id);
        if(id==null||!ids.has(id)){
          own.push(copy(item));if(id!=null)ids.set(id,item);
          noIds.add(raw);stats.added++;return;
        }
        // Preserve BOTH records on an ID collision with different contents.
        // A stable alternative ID makes repeating the same merge idempotent.
        const base=id+'-cloud-'+snapshotId.slice(0,8);
        let alt=base, n=1;
        while(ids.has(alt)){
          const existing=ids.get(alt);
          if(stable(existing)===stable(Object.assign({},item,{id:alt})))return;
          alt=base+'-'+(++n);
        }
        const other=Object.assign({},copy(item),{id:alt});
        own.push(other);ids.set(alt,other);
        noIds.add(stable(other));stats.added++;stats.conflicts++;
      });
      output[key]=own;
    });
    // Keep local preference and display state, but do not lose higher mileage.
    output.odo=Math.max(Number(output.odo)||0,Number(remote.odo)||0);
    if(!output.bike&&remote.bike)output.bike=remote.bike;
    if(!['mi','km'].includes(output.unit))output.unit=remote.unit||'km';
    return {output,stats};
  }
  async function mergeFromCloud(id){
    if(busy||!saved.some(s=>s.id===id))return;
    setBusy(true);
    try{
      const {client,user}=await auth();
      status('Downloading private cloud copy…');
      const {data,error}=await client.from('ride_garage_cloud_snapshots')
        .select('garage,created_at').eq('user_id',user.id).eq('id',id).single();
      if(error)throw error;
      if(!data||!data.garage)throw Error('The cloud copy is missing.');
      const remote=api.validate(JSON.stringify(data.garage));
      const initialLocal=api.readState?await api.readState():api.getState();
      const {stats}=mergeGarages(initialLocal,remote,id);
      const notice=tr('Merge cloud copy into this device?\n\n{summary}\n\nAdds {added} records, including {conflicts} differing versions kept separately. Existing records are NEVER deleted or overwritten. Your local bike name and unit stay the same; the larger odometer is kept.\n\nDownload a backup file first for extra protection. Continue?',{summary:describe(counts(remote)),added:stats.added,conflicts:stats.conflicts});
      if(!confirm(notice)){status('Merge cancelled. Local records are unchanged.');return}
      // Re-read after confirmation to avoid using a stale page-load snapshot.
      const latest=api.readState?await api.readState():api.getState();
      const merged=mergeGarages(latest,remote,id);
      await api.persist(merged.output);
      api.setState(merged.output);
      status('Cloud merge saved locally. {added} records added; {conflicts} differing versions retained. Your cloud copy was not modified. Save a new cloud copy to share these changes with another device.',{added:merged.stats.added,conflicts:merged.stats.conflicts});
    }catch(e){status('Cloud merge failed (existing local data is unchanged): {error}',{error:tr(e.message||String(e))})}
    finally{setBusy(false)}
  }
  function init(services){
    api=services;
    const up=$('rgCloudUpload'),rf=$('rgCloudRefresh'),login=$('rgCloudLogin');
    if(up)up.addEventListener('click',upload);
    if(rf)rf.addEventListener('click',listCloud);
    if(login)login.addEventListener('click',()=>api.openSocial());
    refreshAuth();
  }
  window.addEventListener('rg-language-change',()=>{renderAuth();if(listed){makeList(saved);if(busy)setBusy(true);}const el=$('rgCloudStatus'),last=el&&el._rgI18nStatus;if(last)status(last.text,last.params);});
  window.RideGarageCloud={init,refreshAuth};
})();