const CACHE='https://drtjqdfunggnzsbkseysx.supabase.co';
const FILES=['./','index.html','https://eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRydGpxZGZ1bmdnenNia3NleXN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY5MjQxNjEsImV4cCI6MjA3MjUwMDE2MX0.TCgvpjG69PgEcHuCFJOoQcUMGUIWphtnOPyc5eJ19cA ','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.origin!==location.origin)return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return res}).catch(()=>caches.match('index.html'))));
});
