# Ride Garage 2.0

The existing web PWA runs from the repository root. Supabase services and manual private Cloud Garage Sync remain optional.

The native iPhone app uses Capacitor 8 and a local Swift/Core Location recorder for active rides, including when the screen is locked. See [iPhone build, testing, permissions and release guide](docs/IOS-TRACKING.md).

Native recording source: [native/ride-recorder](native/ride-recorder). The iOS project and bundled web assets are generated with `npm ci && npm run ios:init` on a Mac; they do not replace existing PWA storage.
