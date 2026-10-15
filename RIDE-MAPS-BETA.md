# Ride Garage — Interactive Ride Maps (beta)

## What changed
- **Trips:** Tap **Interactive map** on a recorded ride to explore its existing saved GPS points on a draggable/zoomable OpenStreetMap map. A green pin marks the start; an orange pin marks the finish. The original route preview SVG remains as a fallback.
- **Live recording:** Start recording on the Trips screen, wait for a GPS point, and tap **Interactive live map**. The map line and current pin update as GPS points arrive, without changing how trips are recorded/saved.
- **Places:** Tap **Show places map** to view saved places that have latitude,longitude coordinates; tap pins for name, category and directions. Address-only places remain visible in their original list with their navigation links.
- **Cloud Sync:** Existing cloud snapshots already include `trips[].pts` and `places[].coords`; **no database migration or new permissions are required**. Manual Cloud Sync remains opt-in.
- **Privacy:** Interactive map tiles load only on request; locations already stored in the garage are not newly uploaded as route data. Visible map viewport requests go to OpenStreetMap's tile server and may disclose a region and network metadata. Supabase accounts, Social and garage records are untouched.

## iPhone/iPad tests
1. **Back up first:** Use **Download backup file** and verify it exists. Record the current counts for builds, trips, places, service, and fuel.
2. **Past ride:** Open **Trips**, find a saved ride with GPS, tap **Interactive map**, pan and pinch-zoom; check the line and green/orange markers. Tap **Close map** and confirm the original route preview returns.
3. **Live map:** When safe and stationary, start a test ride recording and wait for GPS. Tap **Interactive live map**. Confirm the map shows new points as they arrive. Stop and save. Do not interact with the screen while riding.
4. **Saved places:** Open **Places**, tap **Show places map**. Saved coordinate locations should have pins and working **Directions** links. Address-only entries should still have their original navigation buttons.
5. **No GPS:** On **Places**, save an address-only entry and check that it remains usable even though not plotted. On **Trips**, a ride without valid GPS should keep the original preview.
6. **Offline behavior:** Switch offline and open a saved trip. Existing route SVGs and garage records remain available; selecting an interactive map can show a connection warning.
7. **Persistence:** Refresh the app and confirm motorcycle photos, modifications, service, fuel, trips and places haven't changed. Existing Cloud Sync **Save a cloud copy / Merge** functions still work on both devices.
8. **Mobile layout:** Verify that map controls, attribution, top content and the bottom nav are tappable, with no sideways scrolling or map overlapping buttons.

## Technical notes
- Uses pinned Leaflet 1.9.4 from jsDelivr; CSS and JS load only on a map button click.
- Uses `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, visible OpenStreetMap attribution, no tile prefetching, no offline tile downloads. Respect OSM's tile policy; consider a dedicated tile provider if audience scales.
- Each map is destroyed on a tab redraw to prevent zombie maps and unwanted tile traffic.
- Only valid latitude/longitude values are plotted. Route rendering caps UI points for browser performance without changing saved GPS arrays.
- This is historical route visualization, **not** turn-by-turn routing or a dedicated offline map service.
- Manual Cloud Sync handles saved routes the same way it did before; map viewing doesn't trigger cloud uploads.

References:
- https://leafletjs.com/reference.html
- https://operations.osmfoundation.org/policies/tiles/
