# Cloud Garage Sync beta — rollout and test guide

## What this release does

* Garage records remain in the same local IndexedDB `ridegarage` / `kv` / `s`.
* The existing Backup & restore feature is unchanged in the main app. The new dedicated Cloud page also offers a Download local backup button. Create a downloaded backup before testing.
* A compact **☁️ Cloud** link in the main app header opens `cloud.html`; the Cloud Sync panel no longer appears below all six tabs. The original six navigation tabs are unchanged.
* Cloud copies are **explicitly created**, never uploaded automatically.
* Each cloud copy is an immutable private snapshot tied to the logged-in Supabase account.
* A user can view their 10 newest copies and **merge** one into the current device.
* Merge keeps local records and app preferences, adds missing cloud records, preserves divergent versions as separate entries, keeps the higher odometer, and avoids duplicate rows on repeated merges of the same snapshot.
* Local photos and GPS points are included in cloud copies. An upload over approximately 7.8 MB is refused without changing local data. Cloud data is private to the signed-in account, not shared to Social.
* Edits/deletions on one device are **not automatically replicated**. This is manual cross-device sync, designed as a safe beta before automatic two-way sync.

## Database

`supabase/cloud-garage-sync.sql` is installed in the existing Ride Garage Supabase project. It adds `public.ride_garage_cloud_snapshots`, with owner-only RLS, authenticated SELECT/INSERT grants, and no UPDATE/DELETE grant. Account deletion cascades to cloud snapshots. It does not modify other tables.

## Tester walkthrough (use two devices)

1. On **Device A**, open Ride Garage and **Download backup file**. Verify the saved file exists.
2. Confirm your motorcycles, modifications, service, fuel, trips and photos are intact.
3. Open **Social** and sign in. Tap **☁️ Cloud** in the app header to open the dedicated cloud page, then select **Save a cloud copy**. Confirm the explanation of what is uploaded.
4. Select **View cloud copies**. The new copy should appear with a timestamp and record counts.
5. On **Device B**, open the **same app URL**, sign in to the **same account** using Social, tap the **☁️ Cloud** link in the header and select **View cloud copies**, then **Merge into this device**.
6. Confirm the motorcycle, photos, fuel, service, places and trips are now visible on B; pre-existing B records must remain.
7. Repeat the **same merge** on B and verify that no duplicate records are added.
8. Change a record on B, save another cloud copy, then merge it on A. Differing versions of the same record must both remain (no silent overwrite).
9. Return to the main app, sign out on Social, open the dedicated Cloud page, and verify the cloud list is inaccessible without authentication while local garage data remains intact.
10. Turn off Wi-Fi/cellular; the local garage should remain usable. Cloud calls should display errors without clearing local data.

## Known limits and next phase

* This is manual, not real-time or unattended two-way synchronization.
* Deliberately deleted records on one device may reappear if you merge an older cloud copy (the merge is non-destructive by design).
* Changes to the **same** record on two devices are kept as separate versions instead of silently choosing a winner.
* Cloud copies are append-only and cannot individually be deleted in this beta. Account deletion removes the linked database records, subject to any provider backup retention.
* Snapshots include inline base64 JPEGs; users with many photos may exceed the beta upload limit.
* Before automatic background syncing, introduce stable per-device IDs, tombstones for deletes, conflict resolution and explicit consent to automatic photo/route uploads.
