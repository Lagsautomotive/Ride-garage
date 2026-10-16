/* Ride Garage interactive maps.
 * View-only overlay for existing local trips and saved place coordinates.
 * Never edits GPS data, IndexedDB, Cloud Sync, or Social accounts.
 * Maps load only after a rider taps a map button; offline route SVGs stay available.
 */
(function(){
  'use strict';
  const LIB='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/';
  const TILES='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const $=id=>document.getElementById(id);
  let libraryPromise=null,active=null,request=0;
  function coords(value){
    if(!Array.isArray(value)||value.length<2)return null;
    const lat=Number(value[0]),lon=Number(value[1]);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180)return null;
    return [lat,lon];
  }
  function route(points){
    if(!Array.isArray(points))return [];
    const clean=points.map(coords).filter(Boolean);
    return clean;
  }
  function segments(record){
    if(record&&Array.isArray(record.segments)&&record.segments.length)return record.segments.map(route).filter(p=>p.length);
    return [route(record&&record.pts)];
  }
  function placeCoords(place){
    if(!place||typeof place.coords!=='string')return null;
    const parts=place.coords.split(',');
    return parts.length===2&&parts.every(p=>p.trim()!=='')?coords(parts):null;
  }
  function message(el,text){
    if(el){el.textContent=text;el.hidden=false;}
  }
  function ensureLeaflet(){
    if(window.L&&window.L.map&&document.querySelector('link[data-rg-leaflet]'))return Promise.resolve(window.L);
    if(libraryPromise)return libraryPromise;
    const css=new Promise((resolve,reject)=>{
      let link=document.querySelector('link[data-rg-leaflet]');
      if(link){resolve();return;}
      link=document.createElement('link');
      link.rel='stylesheet';link.href=LIB+'leaflet.css';link.dataset.rgLeaflet='1';
      link.onload=resolve;
      link.onerror=()=>{link.remove();reject(Error('Could not load map styles'));};
      document.head.appendChild(link);
    });
    const js=new Promise((resolve,reject)=>{
      if(window.L&&window.L.map){resolve(window.L);return;}
      const script=document.createElement('script');
      script.src=LIB+'leaflet.js';script.async=true;
      script.onload=()=>window.L&&window.L.map?resolve(window.L):reject(Error('Map library did not start'));
      script.onerror=()=>{script.remove();reject(Error('Could not load map code'));};
      document.head.appendChild(script);
    });
    libraryPromise=Promise.all([css,js]).then(([,L])=>L).catch(e=>{libraryPromise=null;throw e});
    return libraryPromise;
  }
  function destroy(){
    request++;
    if(!active)return;
    const a=active;active=null;
    if(a.map){try{a.map.remove();}catch(e){}}
    if(a.host){a.host.hidden=true;a.host.replaceChildren();}
    if(a.preview)a.preview.hidden=false;
    if(a.button)a.button.textContent=a.label;
    if(a.status)a.status.hidden=true;
  }
  function begin(key,host,preview,button,status,label){
    if(active&&active.key===key){destroy();return null;}
    destroy();
    if(!host)return null;
    host.hidden=false;
    if(button)button.textContent='Close map';
    message(status,'Loading interactive map…');
    active={key,host,preview,button,status,label,map:null,line:null,last:null,seen:0};
    return {active,token:request};
  }
  function mapBase(a,L,pts){
    // Leaflet is created only for a visible viewport, never for hidden maps.
    const map=L.map(a.host,{scrollWheelZoom:false,zoomControl:true,preferCanvas:true});
    a.map=map;
    const tiles=L.tileLayer(TILES,{
      maxZoom:19,updateWhenIdle:true,keepBuffer:1,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
    }).addTo(map);
    tiles.on('tileerror',()=>{
      if(active!==a)return;
      if(a.preview)a.preview.hidden=false;
      message(a.status,'Some map tiles could not load. The saved route preview is shown below.');
    });
    if(pts.length===1)map.setView(pts[0],14);
    else if(pts.length>1)map.fitBounds(L.latLngBounds(pts),{padding:[22,22],maxZoom:15});
    else map.setView([0,0],2);
    setTimeout(()=>{if(active===a&&a.map)map.invalidateSize();},150);
    return map;
  }
  function paintRoute(a,L,pts,live,paths){
    if(!pts.length)return;
    a.line=L.polyline(paths||pts,{color:'#dfaa57',weight:5,opacity:0.94,lineJoin:'round'}).addTo(a.map);
    L.circleMarker(pts[0],{radius:7,color:'#fff',weight:2,fillColor:'#2ab873',fillOpacity:1})
      .addTo(a.map).bindPopup('Ride start');
    a.last=L.circleMarker(pts[pts.length-1],{radius:7,color:'#fff',weight:2,fillColor:'#f18b43',fillOpacity:1})
      .addTo(a.map).bindPopup(live?'Current ride position':'Ride finish');
    a.seen=pts.length;
  }
  async function showTrip(index,trips){
    const id='rgTripMap'+index,key='trip-'+index;
    const host=$(id),preview=$('rgTripPreview'+index),btn=$('rgTripButton'+index),status=$('rgTripStatus'+index);
    const arr=Array.isArray(trips)?trips:[],trip=arr[arr.length-1-index];
    const pts=route(trip&&trip.pts);
    if(!pts.length){message(status,'This ride has no recorded GPS points to map.');return;}
    const opening=begin(key,host,preview,btn,status,'Interactive map');
    if(!opening)return;
    const {active:a,token}=opening;
    try{
      const L=await ensureLeaflet();
      if(token!==request||active!==a||!document.contains(host))return;
      mapBase(a,L,pts);
      paintRoute(a,L,pts,false,segments(trip));
      if(a.preview)a.preview.hidden=true;
      message(status,'Drag to explore. Pinch or use + / − to zoom. Route data stays in your garage.');
    }catch(e){
      if(active!==a)return;
      destroy();message(status,'Could not open interactive map. Your saved route preview still works offline.');
    }
  }
  async function showLive(current){
    const host=$('rgLiveMap'),preview=$('map'),btn=$('rgLiveMapButton'),status=$('rgLiveMapStatus');
    const pts=route(current&&current.pts);
    if(active&&active.key==='live'){destroy();return;}
    if(!pts.length){message(status,'Start recording a ride and wait for a GPS point to open the live map.');return;}
    const opening=begin('live',host,preview,btn,status,'Interactive live map');
    if(!opening)return;
    const {active:a,token}=opening;
    try{
      const L=await ensureLeaflet();
      if(token!==request||active!==a||!document.contains(host))return;
      mapBase(a,L,pts);
      paintRoute(a,L,pts,true,segments(current));
      if(preview)preview.hidden=true;
      message(status,window.RGNativeRide&&RGNativeRide.available?'Live route is updating. iPhone recording continues with the screen locked.':'Live route is updating. Keep this screen open while recording.');
    }catch(e){
      if(active!==a)return;
      destroy();message(status,'Live map needs internet. GPS recording and route preview still work.');
    }
  }
  function updateLive(current){
    const a=active;
    if(!a||a.key!=='live'||!a.map||!a.line||!a.last)return;
    const pts=route(current&&current.pts);
    if(!current||!Array.isArray(current.pts)||current.pts.length<=a.seen)return;
    a.line.setLatLngs(segments(current));
    const end=pts[pts.length-1];
    a.last.setLatLng(end);
    a.seen=current.pts.length;
    // Don't continuously recenter while the rider explores the map.
    if(!a.map.getBounds().contains(end))a.map.panTo(end,{animate:false});
  }
  function placePopup(place,pt){
    const node=document.createElement('div');
    const title=document.createElement('strong');title.textContent=String(place.name||'Saved place');node.appendChild(title);
    if(place.cat){const row=document.createElement('div');row.textContent=String(place.cat);node.appendChild(row);}
    const link=document.createElement('a');
    link.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(pt[0]+','+pt[1])+'&travelmode=driving';
    link.target='_blank';link.rel='noopener noreferrer';link.textContent='Directions';
    node.appendChild(link);return node;
  }
  async function showPlaces(places){
    const host=$('rgPlacesMap'),btn=$('rgPlacesMapButton'),status=$('rgPlacesMapStatus');
    if(active&&active.key==='places'){destroy();return;}
    const plotted=(Array.isArray(places)?places:[]).map(p=>({p,pt:placeCoords(p)})).filter(x=>x.pt);
    if(!plotted.length){message(status,'No coordinates to plot yet. Save a place using “Use my location” or latitude,longitude. Address-only places still open in navigation apps.');return;}
    const opening=begin('places',host,null,btn,status,'Show places map');
    if(!opening)return;
    const {active:a,token}=opening;
    try{
      const L=await ensureLeaflet();
      if(token!==request||active!==a||!document.contains(host))return;
      const pts=plotted.map(x=>x.pt);
      mapBase(a,L,pts);
      for(const item of plotted){
        L.circleMarker(item.pt,{radius:8,color:'#fff',weight:2,fillColor:'#dfaa57',fillOpacity:1})
          .addTo(a.map).bindPopup(placePopup(item.p,item.pt));
      }
      const skipped=(Array.isArray(places)?places.length:0)-plotted.length;
      message(status,plotted.length+' saved '+(plotted.length===1?'place':'places')+' on the map.'+
        (skipped?' '+skipped+' address-only/invalid coordinate '+(skipped===1?'entry is':'entries are')+' not plotted.':''));
    }catch(e){
      if(active!==a)return;
      destroy();message(status,'Could not load map tiles. Your saved places and navigation links are unchanged.');
    }
  }
  window.RGMaps={toggleTrip:showTrip,toggleLive:showLive,togglePlaces:showPlaces,updateLive,destroy};
})();