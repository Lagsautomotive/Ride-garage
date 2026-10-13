RIDE GARAGE - install-ready app package
=======================================

Files: index.html, manifest.webmanifest, sw.js, icon-192.png, icon-512.png
Keep all five files together in one folder.

STEP 1 - Back up your current data (so you don't lose it)
  Open your current Ride Garage page > Backup & restore > Download backup file.
  If nothing downloads, tap "Show backup text", copy all the text and save it
  somewhere safe (notes app, email to yourself).

STEP 2 - Put the folder online (free, pick one)
  Netlify Drop:  go to app.netlify.com/drop and drag this folder onto the page.
  GitHub Pages:  create a repo, upload these files, then Settings > Pages.
  Cloudflare Pages: create a project and upload the folder.
  You need the https:// link they give you. GPS only works on https.

STEP 3 - Install on your phone
  iPhone (Safari): open the link > Share > Add to Home Screen.
  Android (Chrome): open the link > menu > Install app (or Add to Home screen).

STEP 4 - Restore your data
  Open the installed app > Backup & restore > Restore from file (or paste the text).

Notes
  - Data is stored on the device; each device has its own copy.
  - The app works offline after the first load. To ship an update, replace the
    files and change CACHE='ride-garage-v1' in sw.js to v2.
  - GPS recording needs the screen on; web apps can't track in the background.
