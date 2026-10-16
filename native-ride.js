/* Native iOS ride recording. Core Location and the durable journal live in Swift.
 * No location request or recording starts during initialization or recovery. */
(function () {
  'use strict';
  const cap = window.Capacitor;
  const available = !!(cap && cap.isNativePlatform() && cap.getPlatform() === 'ios');
  const plugin = available ? cap.registerPlugin('RideRecorder') : null;
  let host, session = null, ready = false, busy = false, failed = false, listener, refreshTimer;
  let metadataQueue = Promise.resolve(), generation = 0;
  const distance = (a, b) => {
    const r = Math.PI / 180, x = (b[0] - a[0]) * r, y = (b[1] - a[1]) * r;
    return 12742 * Math.asin(Math.sqrt(Math.min(1, Math.sin(x / 2) ** 2 +
      Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(y / 2) ** 2)));
  };
  function tripFromSession(s) {
    const gps = s.points;
    const usable = gps.filter(p => Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 &&
      Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180 &&
      Number.isFinite(p.timestamp) && Number.isFinite(p.accuracy) && p.accuracy >= 0 && p.accuracy <= 60);
    const segments = [];
    let previous, dist = 0, max = 0;
    for (const p of usable) {
      const pt = [p.latitude, p.longitude];
      const step = previous ? distance([previous.latitude, previous.longitude], pt) : 0;
      const continuous = previous && step * 1000 / ((p.timestamp - previous.timestamp) / 1000) <= 100 && p.segment === previous.segment &&
        p.timestamp > previous.timestamp && p.timestamp - previous.timestamp <= 30000;
      if (!continuous) segments.push([]);
      else dist += step;
      segments[segments.length - 1].push(pt);
      if (Number.isFinite(p.speed) && p.speed >= 0 && p.speed <= 100) max = Math.max(max, p.speed * 3.6);
      previous = p;
    }
    return {
      id: 'native-' + s.id, nativeSessionId: s.id, source: 'ios-core-location',
      name: s.name || 'Ride ' + new Date(s.startedAt).toLocaleDateString(),
      country: s.country || '', date: s.startedAt, dist,
      dur: s.durationMs, max, pts: usable.map(p => [p.latitude, p.longitude]),
      segments, gps
    };
  }
  function publish(s, rerender = true) {
    session = s || null;
    if (host) {
      if (session) {
        const trip = tripFromSession(session);
        const last = trip.gps[trip.gps.length - 1];
        const speed = session.status === 'recording' && last && last.accuracy <= 60 && Number.isFinite(last.speed) && last.speed >= 0 && last.speed <= 100 ? last.speed * 3.6 : 0;
        host.setCurrent({ ...trip, t0: session.startedAt, sp: speed, status: session.status,
          durationMs: session.durationMs, name: session.name, country: session.country });
      } else host.setCurrent(null);
      if (rerender) host.render();
    }
  }
  function notice(text) { if (host) host.notice(text); }
  function statusText() {
    if (!ready) return 'Checking for a saved iPhone ride…';
    if (!session) return 'iPhone recording saves GPS on this device while the screen is locked. Start asks for precise location. Pause and Stop turn GPS off.';
    if (session.status === 'recording') {
      const last = session.points[session.points.length - 1];
      return 'Recording on iPhone. You can lock the screen. GPS uses battery; check the location indicator. ' +
        (last ? session.points.length + ' fixes saved. Last accuracy: ±' + Math.round(last.accuracy) + ' m.' : 'Waiting for GPS. Try outdoors with Precise Location enabled.');
    }
    if (session.status === 'paused') return 'Paused. Location tracking is off. Resume when you are ready.';
    if (session.status === 'interrupted') return 'An interrupted ride was recovered. Tracking is off. Resume explicitly or Stop & save the recorded portion.' + (session.lastError ? ' ' + session.lastError : '');
    return 'Recording ended. The iPhone copy is kept until it is saved to your garage. Retry saving if needed.';
  }
  async function finish() {
    if (!session || session.status !== 'stopped') return;
    const completed = session;
    const trip = tripFromSession(completed);
    // The transaction must commit before native data is acknowledged. IDs make
    // retrying after a crash between these two operations safe.
    await host.importTrip(trip);
    await plugin.acknowledge({ id: completed.id });
    publish(null);
    notice(trip.pts.length < 2
      ? 'Ride saved with fewer than two usable GPS fixes. The route may be empty. Check Precise Location and try outdoors; any captured accuracy data is kept in the ride.'
      : 'Ride saved on this device. Your normal backup and Cloud Garage Sync include its GPS route.');
  }
  async function act(operation) {
    if (!ready || busy) return;
    busy = true; generation++;
    try { await operation(); }
    catch (error) {
      notice((error.message || String(error)) + ' Any recorded iPhone data is kept. Try again from Rides.');
    } finally { busy = false; host.render(); }
  }
  async function refresh() {
    if (!host || busy) return;
    try {
      const revision = ++generation;
      const result = await plugin.getSession();
      if (busy || revision !== generation) return;
      const oldStatus = session && session.status;
      const same = (!session && !result.session) || (session && result.session && session.id === result.session.id && oldStatus === result.session.status);
      publish(result.session, !same);
      if (same) host.update();
    } catch (e) { notice('Could not read the saved iPhone ride: ' + (e.message || String(e))); }
  }
  async function init(services) {
    if (!available || host) return;
    host = services;
    try {
      const result = await plugin.getSession();
      publish(result.session, false);
      // Subscribe for error/state changes; the native journal remains authoritative.
      listener = await plugin.addListener('sessionChanged', event => {
        if (!busy) {
          generation++;
          const same = (!session && !event.session) || (session && event.session && session.id === event.session.id && session.status === event.session.status);
          publish(event.session, !same);
          if (same) host.update();
          if (event.error) notice(event.error);
        }
      });
      ready = true;
      host.render();
      if (session && session.status === 'stopped') await act(finish);
      // Foreground refresh only. No JS timer is required for background recording.
      refreshTimer = setInterval(() => { if (!document.hidden) refresh(); }, 3000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
      window.addEventListener('pageshow', refresh);
    } catch (e) { failed = true; notice('iPhone recorder could not be opened: ' + (e.message || String(e))); host.render(); }
  }
  function captureMetadata() {
    if (!session || !host) return metadataQueue;
    const metadata = host.readMetadata();
    generation++;
    const id = session.id;
    session = { ...session, ...metadata };
    metadataQueue = metadataQueue.catch(() => {}).then(async () => {
      if (!session || session.id !== id || session.status === 'stopped') return;
      await plugin.updateMetadata(metadata);
    });
    metadataQueue.catch(e => notice('Ride name could not be saved: ' + (e.message || String(e))));
    return metadataQueue;
  }
  function start() { return act(async () => {
    notice('');
    const result = await plugin.start(host.readMetadata());
    publish(result.session);
  }); }
  function pause() { return act(async () => {
    await captureMetadata();
    publish((await plugin.pause()).session);
  }); }
  function resume() { return act(async () => {
    await captureMetadata();
    notice('');
    publish((await plugin.resume()).session);
  }); }
  function stop() { return act(async () => {
    await captureMetadata();
    if (session && session.status !== 'stopped') publish((await plugin.stop()).session);
    await finish();
  }); }
  function retry() {
    if (busy || !host) return;
    const services = host;
    host = null; failed = false;
    return init(services);
  }
  function controlsHTML() {
    if (failed) return '<button class="btn" onclick="RGNativeRide.retry()">Retry recorder</button>';
    const disabled = !ready || busy ? ' disabled' : '';
    if (!session) return '<button class="btn" onclick="startTrack()"' + disabled + '>Start ride</button>';
    if (session.status === 'stopped') return '<button class="btn" onclick="RGNativeRide.stop()"' + disabled + '>Retry saving</button>';
    const toggle = session.status === 'recording'
      ? '<button class="btn alt" onclick="RGNativeRide.pause()"' + disabled + '>Pause</button>'
      : '<button class="btn alt" onclick="RGNativeRide.resume()"' + disabled + '>Resume</button>';
    return toggle + ' <button class="btn" onclick="stopTrack()"' + disabled + '>Stop &amp; save</button>';
  }
  window.RGNativeRide = { available, init, start, pause, resume, stop, refresh, retry,
    captureMetadata, controlsHTML, statusText, tripFromSession };
})();
