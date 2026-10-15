/* Ride Garage Cloud Sync beta: explicit, private, append-only snapshots.
 * Never pushes automatically, clears local data, or changes existing backup/restore.
 */
(function(){
  'use strict';
  const KEYS=['mods','trips','places','svc','slog','fuel'];
  const MAX_BYTES=7800000; // allow room under the server's 8 MB JSONB limit
  let api=null, busy=false, saved=[];
  const $=id=>document.getElementById(id);
  const copy=x=>JSON.parse(JSON.stringify(x));
  const html=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const size=x=>new TextEncoder().encode(JSON.stringify(x)).length;
  function status(message){const el=$('rgCloudStatus');if(el)el.textContent=message;}
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
  function describe(c){return 'Builds '+(c.mods||0)+' · Trips '+(c.trips||0)+' · Places '+(c.places||0)+' · Service '+(c.svc||0)+' · Fuel '+(c.fuel||0);}
  async function auth(){
    if(!api)throw Error('Cloud Sync is not ready yet.');
    const client=await api.getClient();
    const {data,error}=await client.auth.getUser();
    if(error)throw error;
    const user=data&&data.user;
    if(!user)throw Error('Sign in on the Social tab first. Then return here to save or restore cloud copies.');
    return {client,user};
  }
  function clearList(){saved=[];const e=$('rgCloudCopies');if(e)e.innerHTML='';}
  async function refreshAuth(){
    const box=$('rgCloudAuth');
    if(!box||!api)return;
    try{
      const {user}=await auth();
      box.textContent='Signed in as '+(user.email||'your rider account')+'. Cloud copies are private to this account.';
    }catch(e){
      box.textContent='Not signed in. Use the Social tab to sign in or create an account.';
      clearList();
    }
  }
  function makeList(rows){
    saved=rows||[];
    const el=$('rgCloudCopies');if(!el)return;
    if(!saved.length){el.innerHTML='<p class="mu">No cloud copies yet. Save your garage from this device first.</p>';return}
    el.innerHTML='<p class="mu">Your 10 newest private cloud copies (newest first):</p>'+
      saved.map(r=>{
        const date=new Date(r.created_at).toLocaleString();
        return '<div class="rg-cloud-copy"><div><b>'+html(date)+'</b><div class="mu">'+html(describe(r.summary||{}))+' · '+Math.ceil((r.byte_size||0)/1024)+' KB</div></div>'+
          '<button type="button" class="btn alt sm" data-cloud-id="'+html(r.id)+'">Merge into this device</button></div>';
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
    }catch(e){status('Could not load cloud copies: '+(e.message||String(e)))}
    finally{setBusy(false)}
  }
  async function upload(){
    if(busy)return;
    setBusy(true);
    try{
      const {client,user}=await auth();
      const garage=snapshot(api.getState()),json=JSON.stringify(garage);
      const bytes=new TextEncoder().encode(json).length;
      if(bytes>MAX_BYTES)throw Error('Your garage is '+Math.ceil(bytes/1024/1024)+' MB, over the cloud beta limit. Your photos are safe locally. Use Download backup file until larger uploads are supported.');
      const ok=confirm('Create a PRIVATE cloud copy of this device\'s garage?\n\nThis includes motorcycle records, maintenance, fuel, GPS trip points, saved places and embedded photos. It stays tied to your signed-in account.\n\nThis does not delete or replace anything on your device.');
      if(!ok){status('Upload cancelled. Your garage was not changed.');return}
      status('Uploading a private garage copy…');
      const {error}=await client.from('ride_garage_cloud_snapshots')
        .insert({user_id:user.id,garage,summary:counts(garage),byte_size:bytes});
      if(error)throw error;
      status('Private cloud copy saved. Local data was not changed.');
    }catch(e){status('Cloud upload failed (local garage is unchanged): '+(e.message||String(e)))}
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
      const noIds=new Set(own.map(item=>JSON.stringify(item)));
      incoming.forEach((item,i)=>{
        const raw=JSON.stringify(item);
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
          if(JSON.stringify(existing)===JSON.stringify(Object.assign({},item,{id:alt})))return;
          alt=base+'-'+(++n);
        }
        const other=Object.assign({},copy(item),{id:alt});
        own.push(other);ids.set(alt,other);
        noIds.add(JSON.stringify(other));stats.added++;stats.conflicts++;
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
      const {output,stats}=mergeGarages(api.getState(),remote,id);
      const notice='Merge cloud copy into this device?\n\n'+describe(counts(remote))+
        '\n\nAdds '+stats.added+' records, including '+stats.conflicts+' differing versions kept separately. Existing records are NEVER deleted or overwritten. Your local bike name and unit stay the same; the larger odometer is kept.\n\nDownload a backup file first for extra protection. Continue?';
      if(!confirm(notice)){status('Merge cancelled. Local records are unchanged.');return}
      await api.persist(output);
      api.setState(output);
      status('Cloud merge saved locally. '+stats.added+' records added; '+stats.conflicts+' differing versions retained. Your cloud copy was not modified. Save a new cloud copy to share these changes with another device.');
    }catch(e){status('Cloud merge failed (existing local data is unchanged): '+(e.message||String(e)))}
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
  window.RideGarageCloud={init,refreshAuth};
})();