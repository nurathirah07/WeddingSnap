# Wedding Snap 📸

A modern photobooth web app for weddings. Guests scan a QR code, shoot photos with their own phone and every photo lands in one Google Drive album.

No app download, no login. Total cost: RM0.

## Features

- **Layouts:** Single, 2-Grid strip, 3-Cut strip, 4-Cut classic strip and 4-Grid (2 × 2)
- **Booth mode:** auto-sequence with a 3 / 5 / 10 s countdown, flash, beeps and a shutter sound
- **Filters:** live preview while shooting, and you can change them after shooting
- **Frames:** themed frames (Noir, Ivory, Blush, Sage, Film), plus your own Canva PNGs. Drop them in `frames/` and the photo windows are found automatically.
- **Retakes:** tap any photo on the edit screen to retake just that one
- **Gallery picks:** choose a photo from the phone instead of the camera
- **Uploads:** photos go automatically to Google Drive
- **Shared gallery:** everyone's photos, with a "Mine" tab
- **Delete:** guests can delete their own uploads, but not anyone else's
- **Save to phone:** opens the share sheet on mobile, downloads on desktop
- **Music:** starts on the first tap. It shuffles the songs in `music/`, jumps straight to the chorus, mixes between songs with DJ transitions and repeats forever (Web Audio API). It also turns down during the countdown.

## Project files

```
index.html           page structure (all screens)
css/style.css        design
js/config.js         ⭐ SETTINGS: names, date, frames, filters, layouts
js/app.js            booth logic, canvas drawing, upload, gallery
js/filters.js        filter maths (works on iPhone too)
js/audio.js          music + sound effects
frames/              drop Canva PNGs here (frames.json is made automatically)
music/               drop mp3s here (songs.json is made automatically)
tools/               build-music.mjs (finds choruses), build-frames.mjs
                     (finds photo windows), preview-music.html
apps-script/Code.gs  Google Drive backend
.github/workflows/   auto scan songs + frames, publish to GitHub Pages
```

## 1. Personalise

Edit `js/config.js` and set `TITLE`, `COUPLE` and `DATE`.

## 2. Add your Canva frames

To add a frame, export a PNG from Canva, put it in `frames/` and push to GitHub. That's all.

On every push, `tools/build-frames.mjs` looks at each new PNG and finds its photo windows. A window is a big rectangle that's different from the frame's background:

- **Transparent window:** the photo goes under the frame, so flowers that hang over the edge stay on top.
- **Solid colour box or Canva placeholder picture:** the photo is drawn on top of it.

The number of windows decides which layout the frame belongs to:

| Windows | Layout |
| --- | --- |
| 1 | Single |
| 2 | 2-Grid |
| 3 | 3-Cut |
| 4 in a column | 4-Cut |
| 4 in a 2 × 2 grid | 4-Grid |
| any other number | The frame gets its own layout card |

The results are saved to `frames/frames.json`. To check new frames on your computer before pushing, run `npm run frames`. It prints how many windows it found in each frame.

You can edit `frames.json` by hand, for example to change a frame's `name`. Your edits are kept unless you replace the PNG with a different file.

Tips:

- Make the background around the edge one plain colour, so the scanner can tell frame from window.
- Big Canva exports are fine; they're scaled down to 2400 px automatically.

## Music

To add a song, put the mp3 in `music/` and push to GitHub. That's all.

How it plays:

- **Start:** music starts on the guest's first tap. Browsers never allow sound before the user touches the page, so this is as early as possible. If a guest turns it off, it stays off for them next time.
- **Order and repeat:** every chorus clip plays once in random order, then the list reshuffles and repeats. It avoids playing the same song twice in a row whenever the mix of songs allows.
- **Transitions:** each change uses a random DJ transition: `crossfade`, `sweep` (a muffled filter sweep), `echo` (the song echoes away) or `tapestop` (the song slows down like a record). Choose which ones are used in `CONFIG.MUSIC.TRANSITIONS`.

On every push, GitHub runs `tools/build-music.mjs`, which:

1. finds every mp3 in `music/`
2. works out the chorus (the loudest sections) of any new or changed song
3. writes the list to `music/songs.json`, which the app reads

To remove a song, delete the mp3 and push again.

To try new songs on your computer before pushing, run `npm install` once, then `npm run music` (songs only) or `npm run build` (songs and frames). This updates `music/songs.json` on your computer.

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
3. Set `FOLDER_ID` at the top.
4. Choose `testSetup` and click **Run**, then allow access when asked.
5. Go to **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the Web app URL (it ends in `/exec`) into `SCRIPT_URL` in `js/config.js`.

> If gallery thumbnails don't show, open the Drive folder, go to **Share → General access → Anyone with the link → Viewer**.

> After changing `Code.gs`, go to **Deploy → Manage deployments → Edit → Version: New version**. If you skip this, the old code keeps running.

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
