// =========================================================
//  Sound (Web Audio API)
//  - background music: plays music/songs.json in shuffled order
//    (then reshuffles and repeats), jumping to the best parts and
//    mixing between songs with DJ transitions.
//    (No songs = a built-in music-box melody.)
//  - countdown beeps + camera shutter sound
//  Browsers only allow sound after the first tap, so everything
//  starts lazily from unlock().
// =========================================================
const Sound = (() => {
  const M = CONFIG.MUSIC;
  M.SONGS = [];
  let SEEK_STEP = 2;

  // Opened straight from the folder (index.html double-clicked, no server).
  // Browsers block fetch() on file:// pages, so the song list comes from
  // music/songs.js instead and songs play through <audio> players (see below).
  const LOCAL = location.protocol === "file:";

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Song list + chorus times + seek tables, made by tools/build-music.mjs.
  // Loaded straight away so it's ready before the first tap.
  const songsLoaded = (LOCAL
      ? loadScript("music/songs.js").then(() => window.SONGS_DATA || {})
      : fetch("music/songs.json", { cache: "no-cache" }).then((res) => res.json()))
    .then((data) => { M.SONGS = data.songs || []; SEEK_STEP = data.seekStep || 2; })
    .catch(() => console.warn("No music/songs.json - using the built-in melody"));

  let ac = null;          // AudioContext
  let musicGain = null;   // master volume for the music (fade in/out, ducking)
  let fxGain = null;      // volume for beeps/shutter
  let playing = false;
  let generation = 0;     // bumps on stop, so old timers know to give up

  function unlock() {
    if (!ac) {
      // iPhone: play like a music app, even with the silent switch on
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
      ac = new (window.AudioContext || window.webkitAudioContext)();
      // Safety limiter: louder songs are evened out (see loudness()), this
      // catches any peaks so nothing ever distorts
      const limiter = ac.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      limiter.connect(ac.destination);
      musicGain = ac.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(limiter);
      fxGain = ac.createGain();
      fxGain.gain.value = 0.5;
      fxGain.connect(ac.destination);
      // Phones pause the sound when something interrupts the page (a pop-up,
      // a call, a notification): start again straight away when possible
      ac.onstatechange = () => { if (playing && ac.state !== "running" && !document.hidden) resume(); };
    }
    if (ac.state === "suspended") ac.resume();
  }

  // Pick the music up again after an interruption (see app.js keepAlive)
  function resume() {
    if (!playing || !ac) return;
    if (ac.state !== "running") ac.resume().catch(() => {});
    if (LOCAL && current && current.paused) current.play().catch(() => {});
  }

  // =========================================================
  //  Song player - all Web Audio, no <audio> elements.
  //
  //  Only the chorus clip is downloaded: songs.json has a seek table
  //  (the byte where every 2 s of the mp3 starts), so we ask the server
  //  for just those bytes (an HTTP "Range" request), decode them into
  //  sound in memory, and play that.  ~1 MB per clip instead of 3-9 MB
  //  per song. The next clip is downloaded while this one plays.
  //
  //  Two decks, like a DJ:  clip → filter → volume → music out
  //                                  └──→ echo send → shared echo
  // =========================================================
  const PAD = 1;          // extra second fetched each side (the decoder needs a run-up)
  let decks = null;
  let active = 0;         // which deck is playing now
  let nextTimer = null;
  let lastSong = null;
  let failures = 0;
  let queue = [];         // what's left to play this round
  let echoBus = null;
  let upcoming = null;    // { gen, promise } the next clip, fetched + decoded ahead
  let early = null;       // first clip's bytes, fetched before the first tap
  let switching = false;  // a change of clip is in progress
  const downloads = new Set();   // AbortControllers, so Stop cancels downloads

  function makeEchoBus() {
    echoBus = ac.createGain();
    const delay = ac.createDelay();
    delay.delayTime.value = 0.375;
    const feedback = ac.createGain();
    feedback.gain.value = 0.5;
    const tone = ac.createBiquadFilter();   // each repeat gets a bit darker
    tone.type = "lowpass";
    tone.frequency.value = 2500;
    echoBus.connect(delay);
    delay.connect(tone).connect(feedback).connect(delay);
    tone.connect(musicGain);
  }

  function makeDeck() {
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    const send = ac.createGain();
    filter.connect(gain).connect(musicGain);
    filter.connect(send).connect(echoBus);
    const deck = { filter, gain, send, source: null, level: 1 };
    resetDeck(deck);
    gain.gain.value = 0;
    return deck;
  }

  // Back to normal: no filter, no echo
  function resetDeck(d) {
    const t = ac.currentTime;
    d.filter.type = "lowpass";
    d.filter.frequency.cancelScheduledValues(t);
    d.filter.frequency.setValueAtTime(20000, t);
    d.filter.Q.value = 0.7;
    d.send.gain.cancelScheduledValues(t);
    d.send.gain.setValueAtTime(0, t);
  }

  // Stop the clip on a deck and let its memory go
  function stopDeck(d) {
    if (!d.source) return;
    d.source.onended = null;
    try { d.source.stop(); } catch (e) {}
    d.source.disconnect();
    d.source = null;
  }

  // Every highlight of every song is one "segment" (whole songs in "full"
  // mode). Each round plays ALL of them once in shuffled order, then
  // reshuffles and repeats. Tries to avoid the same song twice in a row.
  function allSegments() {
    const pool = [];
    M.SONGS.forEach((song) => {
      if (M.MODE === "highlights" && song.highlights && song.highlights.length) {
        song.highlights.forEach((t) => pool.push({ song, start: t }));
      } else {
        pool.push({ song, start: null });   // null = a random spot (or 0 in "full" mode)
      }
    });
    return pool;
  }

  // Random order where the same song never plays twice in a row (if possible).
  // Picks at random, but if one song has so many clips left that it would
  // be forced to repeat later, that song goes next.
  function shuffle(pool) {
    const left = pool.slice();
    const order = [];
    let prev = lastSong;
    while (left.length) {
      const count = new Map();
      left.forEach((s) => count.set(s.song, (count.get(s.song) || 0) + 1));
      const [busiest, most] = [...count].sort((a, b) => b[1] - a[1])[0];

      let options = left.filter((s) => s.song !== prev);
      if (busiest !== prev && most * 2 > left.length) options = options.filter((s) => s.song === busiest);
      if (!options.length) options = left;   // only one song left: no choice

      const pick = options[Math.floor(Math.random() * options.length)];
      left.splice(left.indexOf(pick), 1);
      order.push(pick);
      prev = pick.song;
    }
    return order;
  }

  function nextSegment() {
    if (!queue.length) queue = shuffle(allSegments());
    const seg = queue.shift();
    lastSong = seg.song;
    return seg;
  }

  // ---------- Downloading just the clip ----------
  // Byte where the 2 s step at or before `t` starts, and that step's time
  function seekBefore(song, t) {
    t = Math.max(0, t);
    if (song.seek && song.seek.length) {
      const i = Math.min(song.seek.length - 1, Math.floor(t / SEEK_STEP));
      return { byte: song.seek[i], time: i * SEEK_STEP };
    }
    // No seek table (old songs.json): assume a steady bitrate
    return { byte: Math.floor((t / song.duration) * song.bytes), time: t };
  }

  // Byte where the step at or after `t` starts (end of the download)
  function seekAfter(song, t) {
    if (song.seek && song.seek.length) {
      const i = Math.ceil(t / SEEK_STEP);
      return i < song.seek.length ? song.seek[i] : song.bytes;
    }
    return Math.min(song.bytes, Math.ceil((t / song.duration) * song.bytes));
  }

  // Where in the song a segment starts, and how long it plays
  function clipTimes(seg) {
    const dur = seg.song.duration || 0;
    let start = M.MODE === "full" ? 0
      : seg.start !== null ? seg.start
      : dur * (0.2 + Math.random() * 0.5);   // no highlights: somewhere in the middle
    start = Math.max(0, Math.min(start, dur - 10));
    const playFor = M.MODE === "full" ? dur - start : Math.min(M.CLIP_SECONDS, dur - start);
    return { start, playFor };
  }

  // Download the bytes for one segment. Returns { seg, data, offset, playFor }
  // where offset = how far into the downloaded audio the clip starts.
  async function fetchClip(seg) {
    const song = seg.song;
    const dur = song.duration || 0;
    const { start, playFor } = clipTimes(seg);

    // "full" mode plays whole songs, so it downloads whole files
    const headers = {};
    let from = { byte: 0, time: 0 };
    if (M.MODE !== "full" && dur && song.bytes) {
      from = seekBefore(song, start - PAD);
      const to = seekAfter(song, start + playFor + PAD);
      headers.Range = `bytes=${from.byte}-${to - 1}`;
    }

    const ctl = new AbortController();
    downloads.add(ctl);
    try {
      const res = await fetch(encodeURI(song.src), { headers, signal: ctl.signal });
      if (!res.ok) throw new Error("Can't load " + song.src);
      // 206 = we got just the clip. 200 = the server sent the whole file
      // (some local test servers can't do Range): fine, start from 0.
      const t0 = res.status === 206 ? from.time : 0;
      return { seg, data: await res.arrayBuffer(), offset: Math.max(0, start - t0), playFor };
    } finally {
      downloads.delete(ctl);
    }
  }

  // Older Safari only has the callback form of decodeAudioData
  const decode = (data) => new Promise((resolve, reject) => ac.decodeAudioData(data, resolve, reject));

  async function decodeClip(f) {
    const buffer = await decode(f.data);
    f.data = null;   // the mp3 bytes aren't needed once decoded
    return { ...f, buffer, offset: Math.min(f.offset, Math.max(0, buffer.duration - 1)), level: loudness(buffer) };
  }

  const loadClip = (seg) => fetchClip(seg).then(decodeClip);

  // Songs are mastered at different volumes. Measure the clip (every
  // 64th sample is plenty) and turn quiet ones up / loud ones down.
  function loudness(buffer) {
    let sum = 0, n = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i += 64) { sum += d[i] * d[i]; n++; }
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    return rms ? Math.min(1.5, Math.max(0.5, 0.17 / rms)) : 1;
  }

  // Get the clip after this one ready in the background
  function prefetch(gen) {
    if (upcoming || gen !== generation || !playing) return;
    const promise = loadClip(nextSegment());
    promise.catch(() => {});   // handled when it's used
    upcoming = { gen, promise };
  }

  // Before the first tap: download (not decode - that needs the tap) the
  // first clip, so music starts almost as soon as the guest taps.
  function preload() {
    songsLoaded.then(() => {
      if (early || !M.SONGS.length) return;
      const promise = LOCAL ? openClip(nextSegment()) : fetchClip(nextSegment());
      promise.catch(() => {});
      early = promise;
    });
  }

  function fade(gainNode, to, seconds) {
    const t = ac.currentTime;
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setValueAtTime(gainNode.gain.value, t);
    gainNode.gain.linearRampToValueAtTime(to, t + seconds);
  }

  async function playNext(gen) {
    if (gen !== generation || switching) return;
    switching = true;
    clearTimeout(nextTimer);

    let clip;
    try {
      if (upcoming && upcoming.gen === gen) clip = await upcoming.promise;
      else if (early) clip = await decodeClip(await early);
      else clip = await loadClip(nextSegment());
      failures = 0;
    } catch (err) {
      upcoming = null;
      early = null;
      switching = false;
      if (gen !== generation) return;   // stopped meanwhile (download cancelled)
      console.warn(err);
      if (++failures >= M.SONGS.length * 2) {   // nothing plays: use the melody
        console.warn("Songs won't play, switching to built-in melody");
        M.SONGS = [];
        return startMelody();
      }
      nextTimer = setTimeout(() => playNext(gen), 500);
      return;
    }
    upcoming = null;
    early = null;
    switching = false;
    if (gen !== generation) return;

    const oldDeck = decks[active];
    const deck = decks[1 - active];
    stopDeck(deck);
    resetDeck(deck);
    deck.gain.gain.cancelScheduledValues(ac.currentTime);
    deck.gain.gain.setValueAtTime(0, ac.currentTime);
    deck.level = clip.level;

    const src = ac.createBufferSource();
    src.buffer = clip.buffer;
    src.connect(deck.filter);
    src.start(ac.currentTime + 0.05, clip.offset);
    deck.source = src;
    // Safety net: if the next clip is late (slow internet, phone asleep),
    // move on as soon as this one runs out instead of going silent
    src.onended = () => { if (decks[active] === deck && deck.source === src) playNext(gen); };

    active = 1 - active;
    if (oldDeck.source) {
      const name = M.TRANSITIONS[Math.floor(Math.random() * M.TRANSITIONS.length)];
      (TRANSITIONS[name] || TRANSITIONS.crossfade)(oldDeck, deck, M.CROSSFADE);
      console.log("Transition:", name);
    } else {
      fade(deck.gain, deck.level, 1.5);   // very first song: gentle fade in
    }
    // Once the old clip has faded out: stop it, free its memory, and start
    // getting the next clip ready
    setTimeout(() => {
      if (decks[active] !== oldDeck) { stopDeck(oldDeck); resetDeck(oldDeck); }
      prefetch(gen);
    }, (M.CROSSFADE + 2) * 1000);

    announce(clip.seg.song);

    // When to start the next one
    nextTimer = setTimeout(() => playNext(gen), Math.max(5, clip.playFor - M.CROSSFADE) * 1000);
  }

  function announce(song) {
    window.dispatchEvent(new CustomEvent("songchange", {
      detail: { name: songName(song.src), cover: song.cover || null },
    }));
  }

  // =========================================================
  //  Song player for file:// pages (no server).
  //  Same chorus clips and shuffle, played by <audio> players and
  //  crossfaded by turning their volume up and down. (No DJ effects:
  //  Web Audio can't read local files.)
  // =========================================================
  const players = new Set();   // <audio> players playing or fading out
  let current = null;          // the one playing now
  const master = { from: 0, to: 0, start: 0, dur: 1 };   // overall music volume

  // A volume that moves in a straight line from `from` to `to`
  const now = () => performance.now() / 1000;
  const levelOf = (r) => r.from + (r.to - r.from) * Math.min(1, (now() - r.start) / r.dur);
  const rampLevel = (r, to, seconds) =>
    Object.assign(r, { from: levelOf(r), to, start: now(), dur: Math.max(0.01, seconds) });

  if (LOCAL) setInterval(() => {
    const m = levelOf(master);
    players.forEach((el) => { el.volume = Math.max(0, Math.min(1, m * levelOf(el.fade))); });
  }, 50);

  // Load a song into a new player and jump to the clip
  function openClip(seg) {
    const { start, playFor } = clipTimes(seg);
    const el = new Audio();
    el.preload = "auto";
    el.volume = 0;
    el.fade = { from: 0, to: 0, start: 0, dur: 1 };
    return new Promise((resolve, reject) => {
      el.onloadedmetadata = () => { el.currentTime = start; resolve({ seg, el, playFor }); };
      el.onerror = () => reject(new Error("Can't load " + seg.song.src));
      el.src = encodeURI(seg.song.src);
    });
  }

  function release(el) {
    if (el === current) return;
    el.pause();
    el.removeAttribute("src");
    el.load();   // lets the browser free the file
    players.delete(el);
  }

  async function playNextLocal(gen) {
    if (gen !== generation || switching) return;
    switching = true;
    clearTimeout(nextTimer);

    let clip;
    try {
      clip = await (early || openClip(nextSegment()));
      early = null;
      if (gen !== generation) { switching = false; return; }
      await clip.el.play();
      failures = 0;
    } catch (err) {
      early = null;
      switching = false;
      if (gen !== generation) return;
      console.warn(err);
      if (++failures >= M.SONGS.length * 2) {
        console.warn("Songs won't play, switching to built-in melody");
        M.SONGS = [];
        return startMelody();
      }
      nextTimer = setTimeout(() => playNextLocal(gen), 500);
      return;
    }
    switching = false;
    if (gen !== generation) { clip.el.pause(); return; }

    const old = current;
    const el = clip.el;
    players.add(el);
    current = el;
    rampLevel(el.fade, 1, old ? M.CROSSFADE : 1.5);
    if (old) rampLevel(old.fade, 0, M.CROSSFADE);
    el.onended = () => { if (current === el) playNextLocal(gen); };   // safety net
    // After the crossfade: free the old player, get the next clip ready
    setTimeout(() => {
      if (old) release(old);
      if (gen === generation && playing && !early) {
        early = openClip(nextSegment());
        early.catch(() => {});
      }
    }, (M.CROSSFADE + 0.5) * 1000);

    announce(clip.seg.song);
    nextTimer = setTimeout(() => playNextLocal(gen), Math.max(5, clip.playFor - M.CROSSFADE) * 1000);
  }

  // =========================================================
  //  DJ transitions. Each gets the outgoing deck, the incoming
  //  deck (already playing, at volume 0) and a length in seconds.
  //  The incoming deck comes up to its own level (see loudness()).
  // =========================================================
  function ramp(param, to, start, seconds, curve, from = param.value) {
    param.cancelScheduledValues(start);
    param.setValueAtTime(from, start);
    if (curve === "exp") param.exponentialRampToValueAtTime(to, start + seconds);
    else param.linearRampToValueAtTime(to, start + seconds);
  }

  const TRANSITIONS = {
    // Smooth blend: one down, the other up
    crossfade(oldD, newD, T) {
      const t = ac.currentTime;
      ramp(oldD.gain.gain, 0, t, T);
      ramp(newD.gain.gain, newD.level, t, T);
    },

    // Old song gets muffled (like hearing it from another room) while
    // the new one rises in, starting thin and filling out
    sweep(oldD, newD, T) {
      const t = ac.currentTime;
      oldD.filter.Q.value = 4;   // a little "whoosh" on the cutoff
      ramp(oldD.filter.frequency, 200, t, T, "exp");
      ramp(oldD.gain.gain, 0, t, T);
      newD.filter.type = "highpass";
      ramp(newD.filter.frequency, 20, t, T, "exp", 1500);
      ramp(newD.gain.gain, newD.level, t, T * 0.6, null, 0);
    },

    // Old song is cut but keeps echoing away, new one drops in
    echo(oldD, newD, T) {
      const t = ac.currentTime;
      oldD.send.gain.setValueAtTime(1, t);       // feed the echo...
      ramp(oldD.gain.gain, 0, t, 0.4);           // ...cut the dry sound fast
      ramp(oldD.send.gain, 0, t + 0.5, 0.2, null, 1);   // stop feeding, repeats ring out
      ramp(newD.gain.gain, newD.level, t + 1.2, Math.max(1, T * 0.5), null, 0);
    },

    // Old song slows to a stop like a record player losing power -
    // speed AND pitch drop together, like a real turntable
    tapestop(oldD, newD) {
      const t = ac.currentTime;
      const STOP = 1.4;
      if (oldD.source) ramp(oldD.source.playbackRate, 0.2, t, STOP, "exp", 1);
      ramp(oldD.gain.gain, 0, t + STOP * 0.7, STOP * 0.3);
      ramp(newD.gain.gain, newD.level, t + STOP, 0.3, null, 0);   // new song slams in
    },
  };

  // "music/[Playlist] Kembali Pulang.mp3" → "Kembali Pulang"
  function songName(src) {
    return decodeURI(src.split("/").pop()).replace(/\.[^.]+$/, "").replace(/\[.*?\]\s*/g, "");
  }

  // =========================================================
  //  Built-in melody (used when no songs are listed)
  //  I - vi - IV - V in C, played as a gentle arpeggio
  // =========================================================
  const CHORDS = [
    [60, 64, 67, 72], [57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67],
  ];
  const PATTERN = [0, 1, 2, 3, 2, 1, 2, 3];   // which chord note on each step
  const STEP_SEC = 0.32;
  let melodyTimer = null;
  let nextNoteTime = 0;
  let step = 0;

  const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Echo so it sounds like a room, not a ringtone
  let echoIn = null;
  function makeEcho() {
    echoIn = ac.createGain();
    const delay = ac.createDelay();
    delay.delayTime.value = 0.36;
    const feedback = ac.createGain();
    feedback.gain.value = 0.35;
    const tone = ac.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2200;
    echoIn.connect(musicGain);
    echoIn.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(musicGain);
  }

  function pluck(freq, time, vol, length) {
    const osc = ac.createOscillator();
    const osc2 = ac.createOscillator();   // an octave up, quieter: "music box" sparkle
    const env = ac.createGain();
    osc.type = "sine";
    osc2.type = "triangle";
    osc.frequency.value = freq;
    osc2.frequency.value = freq * 2;
    const o2gain = ac.createGain();
    o2gain.gain.value = 0.15;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(vol, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, time + length);
    osc.connect(env);
    osc2.connect(o2gain).connect(env);
    env.connect(echoIn);
    osc.start(time); osc2.start(time);
    osc.stop(time + length + 0.05); osc2.stop(time + length + 0.05);
  }

  // Schedule notes a little ahead of time so timing stays smooth
  function scheduler() {
    while (nextNoteTime < ac.currentTime + 0.3) {
      const chord = CHORDS[Math.floor(step / PATTERN.length) % CHORDS.length];
      const i = step % PATTERN.length;
      pluck(midiToHz(chord[PATTERN[i]] + 12), nextNoteTime, 0.18, 1.6);
      if (i === 0) pluck(midiToHz(chord[0] - 12), nextNoteTime, 0.22, 2.6);   // bass note
      nextNoteTime += STEP_SEC;
      step++;
    }
  }

  function startMelody() {
    if (!echoIn) makeEcho();
    nextNoteTime = ac.currentTime + 0.1;
    melodyTimer = setInterval(scheduler, 100);
    window.dispatchEvent(new CustomEvent("songchange", { detail: { name: "Music box", cover: null } }));
  }

  // =========================================================
  //  Start / stop
  // =========================================================
  const MUSIC_VOLUME = 0.8;
  let ducked = false;

  function setVolume(to, seconds) {
    fade(musicGain, to, seconds);
    if (LOCAL) rampLevel(master, to, seconds);
  }

  function startMusic() {
    unlock();
    playing = true;
    const gen = ++generation;
    setVolume(ducked ? MUSIC_VOLUME * 0.25 : MUSIC_VOLUME, 1.5);

    if (!decks) {
      makeEchoBus();
      decks = [makeDeck(), makeDeck()];
    }

    // Song list is normally loaded long before the first tap, but just in case
    songsLoaded.then(() => {
      if (gen !== generation) return;
      if (M.SONGS.length) (LOCAL ? playNextLocal : playNext)(gen);
      else startMelody();
    });
  }

  function stopMusic() {
    playing = false;
    generation++;
    clearTimeout(nextTimer);
    downloads.forEach((ctl) => ctl.abort());   // don't keep using the guest's data
    upcoming = null;
    early = null;
    switching = false;
    if (!ac) return;
    setVolume(0, 0.8);
    clearInterval(melodyTimer);   // notes already scheduled ring out under the fade
    melodyTimer = null;
    setTimeout(() => {
      if (playing) return;   // turned back on during the fade
      current = null;
      players.forEach(release);
      decks?.forEach((d) => {
        stopDeck(d);
        resetDeck(d);
        d.gain.gain.cancelScheduledValues(ac.currentTime);
        d.gain.gain.setValueAtTime(0, ac.currentTime);
      });
    }, 900);
  }

  // Turn the music down during the countdown so the beeps stand out
  function duck(on) {
    ducked = on;
    if (ac && playing) setVolume(on ? MUSIC_VOLUME * 0.25 : MUSIC_VOLUME, 0.4);
  }

  // =========================================================
  //  Sound effects
  // =========================================================
  function beep(high) {
    if (!ac) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.frequency.value = high ? 1320 : 880;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(env).connect(fxGain);
    osc.start(t); osc.stop(t + 0.2);
  }

  // Shutter = two short bursts of filtered noise ("ka-chik")
  function shutter() {
    if (!ac) return;
    const len = ac.sampleRate * 0.12;
    const buffer = ac.createBuffer(1, len, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    [0, 0.07].forEach((offset, n) => {
      const t = ac.currentTime + offset;
      const src = ac.createBufferSource();
      src.buffer = buffer;
      const band = ac.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = n ? 2500 : 1500;
      const env = ac.createGain();
      env.gain.setValueAtTime(0.9, t);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      src.connect(band).connect(env).connect(fxGain);
      src.start(t); src.stop(t + 0.1);
    });
  }

  // True when the browser lets this page play sound before any tap.
  // Some computers allow it; phones never do.
  function canAutoplay() {
    if (navigator.getAutoplayPolicy) return navigator.getAutoplayPolicy("audiocontext") === "allowed";
    unlock();
    return ac.state === "running";
  }

  return {
    unlock, resume, beep, shutter, duck, canAutoplay, preload,
    get playing() { return playing; },
    toggle() { playing ? stopMusic() : startMusic(); return playing; },
  };
})();
