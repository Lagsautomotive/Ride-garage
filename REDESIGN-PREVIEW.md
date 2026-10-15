# Ride Garage 2.0 — stage 1

## Audit and preservation

This is a static GitHub Pages PWA. index.html contains the existing editors and business logic. Local state is one motorcycle garage in IndexedDB database ridegarage, version 1, store kv, key s. Fields: bike, mods (with photos), trips (with GPS), places, svc, slog, fuel, odo, unit, tab.

This stage adds Home, a photo-led Garage and five fixed navigation destinations. Garage retains the original build editor. Hero photos come from saved modifications; no new photo storage or sample records are introduced. The approved concept is applied with an overlaid Home motorcycle title, outlined icons, charcoal metric cards, a road action card, a compact service check-in, gold Garage progress and a pill-shaped Add build step action. The header uses an original vector Ride Garage mark and a functioning Profile shortcut. A visible toast confirms successful backup restores after returning to Garage.

- Home: saved ride/build/service summaries and shortcuts.
- Garage: original motorcycle name, modifications, photos and sharing.
- Rides: original trip recording/maps plus Saved places.
- Community: original Social authentication, feed and account controls.
- Profile: account link, units, Service, Fuel, Cloud Sync, local Backup & restore, support and installation.

No database schema, security policy, auth configuration, cloud or GPS logic changes. Internal legacy tab IDs remain compatible. Normal launches open Home; index.html#social still opens Community from Cloud. New navigation does not write state.

Styles are isolated in app-shell.css. Service worker cache advances v25 → v27 and precaches the stylesheet. Manifest, scope, relative asset paths and Pages configuration are unchanged.

## Preview before merging

Check out the PR branch in a separate folder:

```sh
git clone https://github.com/Lagsautomotive/Ride-garage.git
cd Ride-garage
git checkout redesign/mobile-shell-home-garage
python3 -m http.server 8080
```

Open http://localhost:8080. This separate origin starts with an empty local garage. Export production records and restore a COPY through Profile → Backup & restore to inspect saved records. Do not clear production site data. Use a test account for social/cloud writes: the configured Supabase project is shared.

For iPhone/iPad, use a trusted HTTPS preview host. GPS and PWA installation need a secure context; an ordinary LAN HTTP address does not qualify. Keep the production Pages source unchanged until merging. Pages does not automatically provide per-PR previews.

## Verification

Implementation checks passed for JavaScript syntax, eight screen renderers, parent navigation, read-only rendering and escaped motorcycle names using a DOM stub. Feature editors and storage/auth/GPS/backup function bodies were compared with the original.

The Redesign browser checks workflow runs Chromium/WebKit on isolated fixture data using the original IndexedDB format. It checks screens at 320/390/768/1024 px, overflow, fixed bottom navigation, preservation while browsing, name editing, backup export and offline reload. Home/Garage screenshots are uploaded as an Actions artifact. Browser execution status is reported in PR checks; live Supabase and physical-device GPS are not covered.

To run browser checks locally, keep the preview server running, then:

```sh
npm install --no-save --package-lock=false playwright@1.51.1
npx playwright install --with-deps chromium webkit
node tests/redesign.cjs
```

## Manual acceptance before merge

Use disposable preview data and a test account:
1. Fresh install: dismiss onboarding, inspect empty states, enter motorcycle name and reload.
2. Garage: inspect existing records/photos; add a mod with photos, update status, zoom, share and delete a test entry.
3. Rides: record GPS, stop/save, inspect saved route and interactive map; test denied permission and offline preview. Navigate away while recording and return to Stop & save.
4. Saved places: add coordinates/GPS and address-only entries; inspect map and external navigation.
5. Profile → Service: inspect history, add/edit an interval, update odometer and mark done. Fuel: inspect old entries, add full/partial tanks and check units/mileage.
6. Backup & restore: download and inspect photos/GPS, test cancelled/invalid restores, restore a copy on the disposable origin.
7. Community: sign in/out, set up rider profile, post/comment/like, report/block/unblock; inspect privacy and beta controls. Check Cloud sign-in returns to Community.
8. Cloud: follow CLOUD-SYNC-BETA.md with a test account on two devices; verify manual upload/merge and sign-out.
9. iPhone/iPad Safari and installed PWA: rotate, enlarge text, use keyboard and VoiceOver, scroll to last control, inspect navigation and map controls for overlap. Check reduced motion.
10. Load online once, disconnect and reload. Local records and SVG previews should work; Community and map tiles require internet.

Later stages can redesign Rides, Community and Profile editors. This stage preserves the single-motorcycle format and does not add new multi-bike or route-planning storage.
