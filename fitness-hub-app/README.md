# Fitness Hub — front end

Cloudflare Pages app. Deliberately a single HTML file with no build step, no
framework and no bundler: it can be read top to bottom, and there is nothing
between the source and what runs on the phone.

`public/` is the entire deployable site.

| File | What |
|---|---|
| `index.html` | The whole app — markup, styles and script in one file |
| `sw.js` | Service worker. Caches the shell so the app opens with no signal |
| `manifest.webmanifest` | Makes it installable to the iOS home screen |
| `icon-192.png` / `icon-512.png` | App icons |

## Status: step 1 of the Stage 4 build

Only the **Running** tab does anything. It holds the refuel calculator, which is
pure arithmetic and needs no database — which is exactly why it was built first.
It proves the deploy, the install and the offline path while there is nothing
else that could be at fault.

The other six tabs render an honest placeholder naming the step that connects
them. An empty tab should never read as a bug.

Race constants in `RACE` mirror `settings` in D1. They are hardcoded **only**
because step 1 has no API. Step 4 reads them live, after which this screen
cannot drift from the database.

## Run it locally

Service workers need a real HTTP origin — opening the file with `file://` will
not register one.

```
cd ~/Documents/fitness-hub/fitness-hub-app/public
python3 -m http.server 8788
```

Then open <http://localhost:8788>.

## Deploy

Use the **pinned** wrangler from the API project. Running bare `npx wrangler`
here would download the newest version instead, which keeps its credentials in a
different file and will ask you to log in again:

```
cd ~/Documents/fitness-hub/fitness-hub-app
../fitness-hub-api/node_modules/.bin/wrangler pages deploy public --project-name fitness-hub
```

## Rules carried over from the backend

- **No fabricated data.** Gaps stay gaps. Sodium shows blank rather than `0`,
  because the gel's sodium content has never been verified off the packet.
- **Nothing here touches v2.** Separate project, separate URL.
- **Never cache API responses in the service worker.** Stale training data shown
  as current is worse than no data. The origin check in `sw.js` enforces this.
