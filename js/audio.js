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

  // Song list + chorus times, made by tools/build-music.mjs.
  // Loaded straight away so it's ready before the first tap.
  const songsLoaded = fetch("music/songs.json", { cache: "no-cache" })
    .then((res) => res.json())
    .then((data) => { M.SONGS = data.songs || []; })
    .catch(() => console.warn("No music/songs.json - using the built-in melody"));

  let ac = null;         // AudioContext
  let musicGain = null;   // master volume for the music (fade in/out, ducking)
  let fxGain = null;      // volume for beeps/shutter
  let playing = false;
  let generation = 0;     // bumps on stop, so old timers know to give up

  function unlock() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      musicGain = ac.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(ac.destination);
      fxGain = ac.createGain();
      fxGain.gain.value = 0.5;
      fxGain.connect(ac.destination);
    }
    if (ac.state === "suspended") ac.resume();
  }

  // =========================================================
  //  Song player: two "decks" (A and B), like a DJ. One fades out
  //  while the other comes in.
  //  <audio> streams the file, so guests don't download whole songs.
  //
  //  Each deck:  <audio> → filter → volume → speakers
  //                          └────→ echo send → shared echo → speakers
  // =========================================================
  let decks = null;
  let active = 0;         // which deck is playing now
  let nextTimer = null;
  let lastSong = null;
  let failures = 0;
  let queue = [];         // what's left to play this round
  let echoBus = null;

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
    const el = new Audio();
    el.preload = "auto";
    el.playsInline = true;
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    const send = ac.createGain();
    ac.createMediaElementSource(el).connect(filter);
    filter.connect(gain).connect(musicGain);
    filter.connect(send).connect(echoBus);
    const deck = { el, filter, gain, send };
    resetDeck(deck);
    gain.gain.value = 0;
    return deck;
  }

  // Back to normal: no filter, no echo, normal speed
  function resetDeck(d) {
    const t = ac.currentTime;
    d.filter.type = "lowpass";
    d.filter.frequency.cancelScheduledValues(t);
    d.filter.frequency.setValueAtTime(20000, t);
    d.filter.Q.value = 0.7;
    d.send.gain.cancelScheduledValues(t);
    d.send.gain.setValueAtTime(0, t);
    clearInterval(d.slowTimer);
    d.el.playbackRate = 1;
    setPreservePitch(d.el, true);
  }

  function setPreservePitch(el, on) {
    el.preservesPitch = on;
    el.webkitPreservesPitch = on;
    el.mozPreservesPitch = on;
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
        pool.push({ song, start: null });   // null = decide once we know the length
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

  function waitFor(el, event) {
    return new Promise((resolve, reject) => {
      el.addEventListener(event, resolve, { once: true });
      el.addEventListener("error", () => reject(new Error("Can't load " + el.src)), { once: true });
    });
  }

  function fade(gainNode, to, seconds) {
    const t = ac.currentTime;
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setValueAtTime(gainNode.gain.value, t);
    gainNode.gain.linearRampToValueAtTime(to, t + seconds);
  }

  async function playNext(gen) {
    if (gen !== generation) return;
    clearTimeout(nextTimer);
    const seg = nextSegment();
    const oldDeck = decks[active];
    const deck = decks[1 - active];
    resetDeck(deck);
    deck.gain.gain.cancelScheduledValues(ac.currentTime);
    deck.gain.gain.setValueAtTime(0, ac.currentTime);

    try {
      deck.el.src = encodeURI(seg.song.src);
      await waitFor(deck.el, "loadedmetadata");
      if (gen !== generation) return;

      const dur = deck.el.duration;
      let start = seg.start;
      if (M.MODE === "full") start = 0;
      else if (start === null) {
        // No highlights given: random spot between 20% and 70% of the song
        start = dur * (0.2 + Math.random() * 0.5);
      }
      start = Math.max(0, Math.min(start, dur - 10));
      deck.el.currentTime = start;
      await deck.el.play();
      if (gen !== generation) { deck.el.pause(); return; }
      failures = 0;
    } catch (err) {
      console.warn(err);
      if (++failures >= M.SONGS.length * 2) {   // nothing plays: use the melody
        console.warn("Songs won't play, switching to built-in melody");
        M.SONGS = [];
        return startMelody();
      }
      nextTimer = setTimeout(() => playNext(gen), 500);
      return;
    }

    active = 1 - active;
    const oldIsPlaying = !oldDeck.el.paused;
    if (oldIsPlaying) {
      const name = M.TRANSITIONS[Math.floor(Math.random() * M.TRANSITIONS.length)];
      (TRANSITIONS[name] || TRANSITIONS.crossfade)(oldDeck, deck, M.CROSSFADE);
      console.log("Transition:", name);
    } else {
      fade(deck.gain, 1, 1.5);   // very first song: gentle fade in
    }
    // Once the old song is gone, stop it and clean up its effects
    setTimeout(() => {
      if (decks[active] !== oldDeck) { oldDeck.el.pause(); resetDeck(oldDeck); }
    }, (M.CROSSFADE + 2) * 1000);

    window.dispatchEvent(new CustomEvent("songchange", { detail: songName(seg.song.src) }));

    // When to start the next one
    const remaining = deck.el.duration - deck.el.currentTime;
    const playFor = M.MODE === "full" ? remaining : Math.min(M.CLIP_SECONDS, remaining);
    nextTimer = setTimeout(() => playNext(gen), Math.max(5, playFor - M.CROSSFADE) * 1000);
  }

  // =========================================================
  //  DJ transitions. Each gets the outgoing deck, the incoming
  //  deck (already playing, at volume 0) and a length in seconds.
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
      ramp(newD.gain.gain, 1, t, T);
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
      ramp(newD.gain.gain, 1, t, T * 0.6, null, 0);
    },

    // Old song is cut but keeps echoing away, new one drops in
    echo(oldD, newD, T) {
      const t = ac.currentTime;
      oldD.send.gain.setValueAtTime(1, t);       // feed the echo...
      ramp(oldD.gain.gain, 0, t, 0.4);           // ...cut the dry sound fast
      ramp(oldD.send.gain, 0, t + 0.5, 0.2, null, 1);   // stop feeding, repeats ring out
      ramp(newD.gain.gain, 1, t + 1.2, Math.max(1, T * 0.5), null, 0);
    },

    // Old song slows to a stop like a record player losing power
    tapestop(oldD, newD) {
      const t = ac.currentTime;
      const STOP = 1.4;
      setPreservePitch(oldD.el, false);          // let the pitch drop too
      const started = performance.now();
      oldD.slowTimer = setInterval(() => {
        const p = Math.min(1, (performance.now() - started) / (STOP * 1000));
        oldD.el.playbackRate = Math.max(0.25, 1 - 0.75 * p * p);
        if (p >= 1) clearInterval(oldD.slowTimer);
      }, 40);
      ramp(oldD.gain.gain, 0, t + STOP * 0.7, STOP * 0.3);
      ramp(newD.gain.gain, 1, t + STOP, 0.3, null, 0);   // new song slams in
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
  }

  // =========================================================
  //  Start / stop
  // =========================================================
  const MUSIC_VOLUME = 0.8;
  let ducked = false;

  function startMusic() {
    unlock();
    playing = true;
    const gen = ++generation;
    fade(musicGain, ducked ? MUSIC_VOLUME * 0.25 : MUSIC_VOLUME, 1.5);

    if (!decks) {
      makeEchoBus();
      decks = [makeDeck(), makeDeck()];
      // iPhone: an <audio> may only play later if it played once during a tap
      decks.forEach((d) => {
        if (M.SONGS.length) d.el.src = encodeURI(M.SONGS[0].src);
        d.el.play().catch(() => {});
        d.el.pause();
      });
    }

    // Song list is normally loaded long before the first tap, but just in case
    songsLoaded.then(() => {
      if (gen !== generation) return;
      if (M.SONGS.length) playNext(gen);
      else startMelody();
    });
  }

  function stopMusic() {
    playing = false;
    generation++;
    clearTimeout(nextTimer);
    if (!ac) return;
    fade(musicGain, 0, 0.8);
    clearInterval(melodyTimer);   // notes already scheduled ring out under the fade
    melodyTimer = null;
    setTimeout(() => {
      if (playing) return;   // turned back on during the fade
      decks?.forEach((d) => {
        d.el.pause();
        resetDeck(d);
        d.gain.gain.cancelScheduledValues(ac.currentTime);
        d.gain.gain.setValueAtTime(0, ac.currentTime);
      });
    }, 900);
  }

  // Turn the music down during the countdown so the beeps stand out
  function duck(on) {
    ducked = on;
    if (ac && playing) fade(musicGain, on ? MUSIC_VOLUME * 0.25 : MUSIC_VOLUME, 0.4);
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

  return {
    unlock, beep, shutter, duck,
    get playing() { return playing; },
    toggle() { playing ? stopMusic() : startMusic(); return playing; },
  };
})();
