# Wedding Snap 📸

A modern photobooth web app for weddings. Guests scan a QR code, shoot photos with their own phone and every photo lands in one Google Drive album.

No app download, no login. Total cost: RM0.

## Features

- **Layouts:** Single, Polaroid, Duo (side by side), 2-Grid, 3-Cut and 4-Cut strips, 4-Grid (2 × 2), Big & Two (1 big + 2 small) and 6-Grid (2 × 3)
- **Booth mode:** auto-sequence with a 3 / 5 / 10 s countdown, flash, beeps and a shutter sound
- **Filters:** live preview while shooting, and you can change them after shooting
- **One print design for every layout:** the photos with the wedding title, names and date underneath. Guests choose the paper **colour** (12), an **effect** (sparkles, hearts, stars, confetti, petals, bokeh, light leak) and a **filter**. Effects stay off faces and off the text.
- **Retakes:** tap any photo on the edit screen to retake just that one
- **Gallery picks:** choose a photo from the phone instead of the camera
- **Uploads:** photos go automatically to Google Drive. With a bad signal they wait on the phone and send by themselves later (never twice).
- **Wishes (ucapan):** guests can add their name and a short wish when they share a photo
- **Live slideshow:** `slideshow.html` on a TV or projector shows new photos as they arrive, with their wishes
- **Shared gallery:** everyone's photos, with a "Mine" tab
- **Delete:** guests can delete their own uploads, but not anyone else's. The couple can hide or delete any photo from the admin page.
- **Table card:** the admin page makes a printable QR card that matches the album cover
- **Save to phone:** opens the share sheet on mobile, downloads on desktop
- **Music:** starts on the first tap. It shuffles the songs in `music/`, jumps straight to the chorus, mixes between songs with DJ transitions and repeats forever (Web Audio API). It also turns down during the countdown.

## Project files

```
index.html           page structure (all screens)
admin.html           admin page: songs, wedding details + text sizes (js/admin.js),
                     photos & wishes, QR table card (js/admin-album.js)
slideshow.html       live slideshow for a TV / projector (js/slideshow.js)
css/style.css        design
js/config.js         ⭐ SETTINGS: names, date, layouts, colours, filters
js/app.js            booth logic, canvas drawing, upload, gallery
js/filters.js        filter maths (works on iPhone too)
js/audio.js          music + sound effects
js/effects.js        effects on the print (sparkles, hearts…)
music/               drop mp3s here (songs.json is made automatically)
tools/               build-music.mjs (finds choruses)
                     (finds photo windows), preview-music.html
apps-script/Code.gs  Google Drive backend
.github/workflows/   auto scan songs, publish to GitHub Pages
```

## 1. Personalise

Edit `js/config.js` and set `TITLE`, `COUPLE` and `DATE`.

## Admin page (songs and wedding details without code)

Open `https://<username>.github.io/<repo>/admin.html`. It isn't linked from the app, and it can't do anything without a token.

1. **Connect:** paste a GitHub token. The page explains how to make one: a fine-grained token for this repo only, with **Contents: Read and write** and **Actions: Read-only**. Give it an expiry date after the wedding.
2. **Wedding details:** edit the title, the couple's names and the date. A preview shows how the bottom of a photo will look. They appear on the welcome cover, the home page and the record sleeve, and are printed on every photo. Three sliders set the **text size** on the photo for the title, names and date (60–150%). If the text gets too big for the space under the photos, it all shrinks together so nothing is cut off. Everything is saved in `settings.json`, which overrides the defaults in `js/config.js`.
3. **Add songs:** add mp3s, listen to them and remove old ones. Each song shows its chorus times with ▶ buttons.
4. **Publish:** all changes go to GitHub in one commit. The Action then finds the choruses and republishes the app. The page shows progress until it says **Live ✓**, which takes about 1–2 minutes.

The token is saved only in that browser (untick "Remember" to forget it when the tab closes). Treat it like a password, and delete it on GitHub after the wedding.

## 2. The print

Every layout uses the same design: the photos on coloured paper, with the title, a thin line, the couple's names and the date underneath (fonts: Runiga, Runethia and Orange Avenue).

On the edit screen, guests choose:

- **Colour:** 12 paper colours, from `COLOURS` in `js/config.js`. Each one sets the paper (`bg`), the title colour (`text`) and the names / date colour (`sub`). Add or change them there.
- **Effect:** from `js/effects.js`. Shapes are placed on the paper and the edges of the photos, never over the middle of a photo (faces) or over the text. They're always in the same places for a layout, so the preview matches the saved photo.
- **Filter:** from `FILTERS` in `js/config.js`.

To add a layout, add it to `LAYOUTS` in `js/config.js`: the print's `width`, `height` and the photo `slots` (x, y, w, h in pixels). `makeGrid()` works out rows and columns for you. Leave space under the photos for the text.

## Music

To add a song, put the mp3 in `music/` and push to GitHub. That's all.

How it plays:

- **Start:** music plays as soon as the app opens wherever the browser allows it. Phones only allow sound after a tap, so there a welcome cover with the couple's names says "Tap to open", and that tap starts the music. If a guest turns music off, it stays off for them next time (and the cover is skipped).
- **Order and repeat:** every chorus clip plays once in random order, then the list reshuffles and repeats. It avoids playing the same song twice in a row whenever the mix of songs allows.
- **Only the chorus is downloaded:** music runs fully on the Web Audio API. `songs.json` has a seek table (where every 2 seconds of each mp3 starts), so the app downloads just the clip it's about to play, about 1 MB instead of a 3–9 MB song. The next clip downloads while the current one plays, and each clip's volume is evened out so quiet and loud songs sound alike. (`MODE: "full"` plays whole songs, so it downloads whole files.)
- **Transitions:** each change uses a random DJ transition: `crossfade`, `sweep` (a muffled filter sweep), `echo` (the song echoes away) or `tapestop` (the song slows down like a record). Choose which ones are used in `CONFIG.MUSIC.TRANSITIONS`.

On every push, GitHub runs `tools/build-music.mjs`, which:

1. finds every mp3 in `music/`
2. works out the chorus (the loudest sections) of any new or changed song
3. writes the list to `music/songs.json`, which the app reads

To remove a song, delete the mp3 and push again.

To try new songs on your computer before pushing, run `npm install` once, then `npm run music`. This updates `music/songs.json` on your computer.

Other things you can do:

- **Hear the chorus picks:** open `http://localhost:8000/tools/preview-music.html` and press ▶.
- **Choose your own times:** edit the `highlights` numbers (in seconds) in `music/songs.json`. Commit the file and your times are kept; they're only recalculated if you replace the mp3 with a different file.
- **Name files simply:** spaces and brackets are fine, but a file with `#`, `?` or `%` in its name is skipped.

Settings in `CONFIG.MUSIC`:

| Setting | What it does |
| --- | --- |
| `MODE: "highlights"` | Plays a clip of each chorus, then crossfades to another song |
| `MODE: "full"` | Plays whole songs in random order, crossfading at the end of each |
| `CLIP_SECONDS` | How long each chorus clip plays |
| `CROSSFADE` | Length of each transition in seconds |
| `TRANSITIONS` | Which transitions to pick from at random |

Keep the mp3s small, since guests stream them on mobile data. 128 kbps is plenty.

## 3. Connect Google Drive

1. Create a folder in Google Drive, for example "Wedding Snap Album". Copy its ID (the long code after `/folders/` in the URL).
2. Go to <https://script.google.com>, create a **New project** and paste in `apps-script/Code.gs`.
3. Set `FOLDER_ID` at the top, and `ADMIN_KEY` to a long secret phrase only the couple knows. It unlocks **Photos & wishes** on the admin page. Only put it in the Apps Script editor, never in this repo (it's public).
4. Choose `testSetup` and click **Run**, then allow access when asked.
5. Go to **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the Web app URL (it ends in `/exec`) into `SCRIPT_URL` in `js/config.js`.

> If gallery thumbnails don't show, open the Drive folder, go to **Share → General access → Anyone with the link → Viewer**.

> After changing `Code.gs`, go to **Deploy → Manage deployments → Edit → Version: New version**. If you skip this, the old code keeps running. The URL stays the same, so `SCRIPT_URL` doesn't change.

## On the day

- **Table cards:** admin page → **Table card** → **Print (4 per A4)**, then cut along the gaps. Scan the preview with your phone first to check the link.
- **Slideshow:** open `https://<username>.github.io/<repo>/slideshow.html` on a laptop connected to the TV or projector and click once for full screen. New photos show up within a few seconds, marked "Just taken". Turn off the laptop's sleep timer.
- **Unsuitable photo?** Admin page → **Photos & wishes** → **Hide**. It disappears from the gallery and the slideshow but stays in your Drive. **Delete** moves it to the Drive bin.
- **Wishes:** read them all under **Photos & wishes → Wishes**, or **Download wishes** for a spreadsheet (they're also in each photo's description in Drive).

## 4. Host on GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages → Source** and choose **GitHub Actions**. Don't choose "Deploy from branch", because then the song list won't be built.
3. Every push now runs `.github/workflows/deploy.yml`, which finds song highlights and publishes the site. Watch it in the **Actions** tab; it takes about 1 minute.
4. Your site will be at `https://<username>.github.io/<repo>/`.
5. Turn that URL into a QR code and put it on the goodies.

The camera only works over **https**. GitHub Pages already uses https. On your computer, `localhost` also works.

## Test locally

```bash
npx serve -l 8000
# open http://localhost:8000
```

Use `serve` rather than `python -m http.server`. Python's server can't skip to the middle of a song, so music would start at 0:00. GitHub Pages doesn't have this problem.
