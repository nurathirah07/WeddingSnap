// =========================================================
//  Effects on the print: sparkles, hearts, stars, confetti...
//  Drawn with code (no image files), so they're sharp at any size.
//  Shapes go on the paper and the edges of the photos - never over the
//  middle of a photo (faces) or over the wedding details.
//  Positions come from a fixed "random" sequence per layout + effect,
//  so the preview and the saved photo always match.
// =========================================================
const EFFECTS = [
  { id: "none",      name: "None" },
  { id: "sparkle",   name: "Sparkles" },
  { id: "hearts",    name: "Hearts" },
  { id: "bows",      name: "Bows" },
  { id: "pearls",    name: "Pearls" },
  { id: "tape",      name: "Washi Tape" },
  { id: "doodles",   name: "Doodles" },
  { id: "butterfly", name: "Butterflies" },
  { id: "stars",     name: "Stars" },
  { id: "confetti",  name: "Confetti" },
  { id: "petals",    name: "Petals" },
  { id: "glitter",   name: "Glitter" },
  { id: "bokeh",     name: "Bokeh" },
  { id: "leak",      name: "Light leak" },
  { id: "datestamp", name: "Date Stamp" },
  { id: "grain",     name: "Film Grain" },
];

const Effects = (() => {
  // Same numbers every time for the same seed
  function seeded(text) {
    let h = 1779033703;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 3432918353), h = (h << 13) | (h >>> 19);
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
  }

  // Is the paper dark? (then white / gold shapes, otherwise deeper colours)
  function isDark(hex) {
    const n = parseInt(hex.slice(1), 16);
    const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return l < 0.45;
  }

  // Places a shape may go: not the middle of a photo, not on the text
  function freeSpots(g, rng, count, size) {
    const bottom = Math.max(...g.slots.map((s) => s.y + s.h));
    const text = { x0: g.width * 0.04, x1: g.width * 0.96, y0: bottom + (g.height - bottom) * 0.08, y1: g.height - (g.height - bottom) * 0.04 };
    // the shape's whole size must stay clear, not just its centre
    const m = size * 0.6;
    const blocked = (x, y) =>
      (x > text.x0 - m && x < text.x1 + m && y > text.y0 - m && y < text.y1 + m) ||
      g.slots.some((s) => x > s.x + s.w * 0.15 - m && x < s.x + s.w * 0.85 + m &&
                          y > s.y + s.h * 0.15 - m && y < s.y + s.h * 0.85 + m);
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 40; tries++) {
      const x = rng() * g.width, y = rng() * g.height;
      if (blocked(x, y)) continue;
      // keep them from piling on top of each other
      if (out.some((p) => Math.hypot(p.x - x, p.y - y) < size * 1.1)) continue;
      out.push({ x, y });
    }
    return out;
  }

  // ---------- Shapes ----------
  function sparkleShape(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x + r * 0.12, y - r * 0.12, x + r, y);
    ctx.quadraticCurveTo(x + r * 0.12, y + r * 0.12, x, y + r);
    ctx.quadraticCurveTo(x - r * 0.12, y + r * 0.12, x - r, y);
    ctx.quadraticCurveTo(x - r * 0.12, y - r * 0.12, x, y - r);
    ctx.fill();
  }

  function heartShape(ctx, x, y, s, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(0, 0.35);
    ctx.bezierCurveTo(-0.62, -0.08, -0.38, -0.7, 0, -0.32);
    ctx.bezierCurveTo(0.38, -0.7, 0.62, -0.08, 0, 0.35);
    ctx.fill();
    ctx.restore();
  }

  function starShape(ctx, x, y, r, angle) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = angle - Math.PI / 2 + (i * Math.PI) / 5;
      const d = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
    ctx.closePath();
    ctx.fill();
  }

  function bowShape(ctx, x, y, s, angle, colour, shade) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(s, s);
    ctx.fillStyle = colour;
    // tails
    ctx.beginPath();
    ctx.moveTo(-0.08, 0.05); ctx.lineTo(-0.42, 0.75); ctx.lineTo(-0.28, 0.68); ctx.lineTo(-0.2, 0.82); ctx.lineTo(0.02, 0.08);
    ctx.moveTo(0.08, 0.05); ctx.lineTo(0.42, 0.75); ctx.lineTo(0.28, 0.68); ctx.lineTo(0.2, 0.82); ctx.lineTo(-0.02, 0.08);
    ctx.fill();
    // loops
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(side * 0.25, -0.45, side * 0.75, -0.4, side * 0.7, -0.02);
      ctx.bezierCurveTo(side * 0.66, 0.3, side * 0.25, 0.22, 0, 0);
      ctx.fill();
      ctx.strokeStyle = shade;
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      ctx.moveTo(side * 0.12, -0.04);
      ctx.quadraticCurveTo(side * 0.4, -0.2, side * 0.55, -0.05);
      ctx.stroke();
    });
    // knot
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.12, 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function butterflyShape(ctx, x, y, s, angle, colours) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(s, s);
    [-1, 1].forEach((side) => {
      const grad = ctx.createLinearGradient(0, 0, side * 0.6, 0);
      grad.addColorStop(0, colours[0]);
      grad.addColorStop(1, colours[1]);
      ctx.fillStyle = grad;
      ctx.beginPath();   // upper wing
      ctx.ellipse(side * 0.28, -0.18, 0.3, 0.22, side * -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();   // lower wing
      ctx.ellipse(side * 0.2, 0.17, 0.2, 0.15, side * 0.6, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = colours[2];
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.04, 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Film grain: a small tile of noise, repeated (cheap, made once)
  let grainTile = null;
  function grain(ctx, w, h, strength) {
    if (!grainTile) {
      grainTile = document.createElement("canvas");
      grainTile.width = grainTile.height = 180;
      const t = grainTile.getContext("2d");
      const img = t.createImageData(180, 180);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      t.putImageData(img, 0, 0);
    }
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = ctx.createPattern(grainTile, "repeat");
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // Corners of each photo, for things that sit on the corners (tape, bows)
  function corners(g, which) {
    return g.slots.flatMap((s, i) => which(i).map(([fx, fy]) => ({ x: s.x + s.w * fx, y: s.y + s.h * fy, i })));
  }

  // ---------- Effects ----------
  const draw = {
    sparkle(ctx, g, rng, u, dark) {
      const colours = dark ? ["#ffffff", "#f6dc8f", "#ffffff"] : ["#d6a84c", "#e9c46a", "#ffffff"];
      freeSpots(g, rng, Math.round((g.width * g.height) / (u * u) * 0.035), u * 1.2).forEach((p, i) => {
        const r = u * (0.35 + rng() * 0.75);
        ctx.fillStyle = colours[i % colours.length];
        ctx.shadowColor = dark ? "rgba(255,240,200,0.9)" : "rgba(214,168,76,0.6)";
        ctx.shadowBlur = r * 0.9;
        sparkleShape(ctx, p.x, p.y, r);
        if (rng() < 0.4) sparkleShape(ctx, p.x + r * 1.3, p.y - r * 1.1, r * 0.4);   // a little one beside it
      });
    },
    hearts(ctx, g, rng, u, dark) {
      const colours = dark ? ["#ff8fb1", "#ffffff", "#f6c1d2"] : ["#e0567a", "#f29bb5", "#c93b62"];
      freeSpots(g, rng, Math.round((g.width * g.height) / (u * u) * 0.025), u * 1.6).forEach((p, i) => {
        ctx.fillStyle = colours[i % colours.length];
        ctx.shadowColor = "rgba(120,20,50,0.25)";
        ctx.shadowBlur = u * 0.3;
        ctx.shadowOffsetY = u * 0.08;
        heartShape(ctx, p.x, p.y, u * (0.9 + rng() * 1.1), (rng() - 0.5) * 0.7);
      });
    },
    stars(ctx, g, rng, u, dark) {
      const colours = dark ? ["#f6d36b", "#ffffff"] : ["#e2b23c", "#f0c95c", "#ffffff"];
      freeSpots(g, rng, Math.round((g.width * g.height) / (u * u) * 0.025), u * 1.4).forEach((p, i) => {
        ctx.fillStyle = colours[i % colours.length];
        ctx.shadowColor = "rgba(180,130,30,0.35)";
        ctx.shadowBlur = u * 0.35;
        starShape(ctx, p.x, p.y, u * (0.4 + rng() * 0.6), rng() * Math.PI);
      });
    },
    confetti(ctx, g, rng, u) {
      const colours = ["#f2a9cb", "#9aaee0", "#f6d36b", "#a8d5b8", "#e0567a", "#c9b0de", "#ffffff"];
      freeSpots(g, rng, Math.round((g.width * g.height) / (u * u) * 0.09), u * 0.6).forEach((p, i) => {
        ctx.fillStyle = colours[i % colours.length];
        ctx.shadowColor = "rgba(0,0,0,0.12)";
        ctx.shadowBlur = u * 0.1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rng() * Math.PI);
        if (rng() < 0.35) { ctx.beginPath(); ctx.arc(0, 0, u * 0.22, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-u * 0.32, -u * 0.13, u * 0.64, u * 0.26);
        ctx.restore();
      });
    },
    petals(ctx, g, rng, u) {
      freeSpots(g, rng, Math.round((g.width * g.height) / (u * u) * 0.035), u * 1.3).forEach((p) => {
        const r = u * (0.5 + rng() * 0.5);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rng() * Math.PI * 2);
        const grad = ctx.createLinearGradient(-r, 0, r, 0);
        grad.addColorStop(0, "#fde3ec");
        grad.addColorStop(1, rng() < 0.5 ? "#ee8fb1" : "#f4b3c8");
        ctx.fillStyle = grad;
        ctx.shadowColor = "rgba(150,50,80,0.25)";
        ctx.shadowBlur = u * 0.25;
        ctx.beginPath();
        ctx.moveTo(-r, 0);
        ctx.quadraticCurveTo(-r * 0.2, -r * 0.75, r, -r * 0.1);
        ctx.quadraticCurveTo(r * 0.1, r * 0.55, -r, 0);
        ctx.fill();
        ctx.restore();
      });
    },
    // soft circles of light over the whole print, mostly near the edges
    bokeh(ctx, g, rng, u) {
      ctx.globalCompositeOperation = "screen";
      const count = Math.round((g.width * g.height) / (u * u) * 0.02) + 6;
      for (let i = 0; i < count; i++) {
        const edge = rng() < 0.75;
        const x = edge ? (rng() < 0.5 ? rng() * 0.25 : 0.75 + rng() * 0.25) * g.width : rng() * g.width;
        const y = rng() * g.height;
        const r = u * (1 + rng() * 2.2);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        const tint = ["255,236,200", "255,205,225", "220,225,255"][i % 3];
        grad.addColorStop(0, `rgba(${tint},0.55)`);
        grad.addColorStop(0.7, `rgba(${tint},0.3)`);
        grad.addColorStop(1, `rgba(${tint},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    // coquette ribbon bows on the photos' top corners, a few more on the paper
    bows(ctx, g, rng, u, dark) {
      const [colour, shade] = dark ? ["#f7d6e0", "#e7aec0"] : ["#f2a7bf", "#d97f9c"];
      ctx.shadowColor = "rgba(120,40,70,0.28)";
      ctx.shadowBlur = u * 0.25;
      ctx.shadowOffsetY = u * 0.06;
      const big = corners(g, (i) => [i % 2 ? [0.92, 0.02] : [0.08, 0.02]]);
      big.forEach((p, i) => bowShape(ctx, p.x, p.y, u * 2.6, (i % 2 ? 0.25 : -0.25), colour, shade));
      freeSpots(g, rng, Math.round((g.width * g.height) / (u * u) * 0.008), u * 2.6)
        .filter((p) => big.every((b) => Math.hypot(b.x - p.x, b.y - p.y) > u * 3.2))   // not on a big bow
        .forEach((p) => bowShape(ctx, p.x, p.y, u * (1.3 + rng() * 0.6), (rng() - 0.5) * 0.8, colour, shade));
    },
    // a string of pearls around the edge of the print
    pearls(ctx, g, rng, u) {
      const inset = u * 0.55, r = u * 0.24, gap = r * 2.25;
      const x0 = inset, y0 = inset, x1 = g.width - inset, y1 = g.height - inset;
      const pts = [];
      for (let x = x0; x <= x1; x += gap) pts.push([x, y0], [x, y1]);
      for (let y = y0 + gap; y < y1; y += gap) pts.push([x0, y], [x1, y]);
      ctx.shadowColor = "rgba(90,70,60,0.3)";
      ctx.shadowBlur = r * 0.8;
      ctx.shadowOffsetY = r * 0.25;
      pts.forEach(([x, y]) => {
        const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.55, "#f4eee8");
        grad.addColorStop(1, "#d9cdc2");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      });
    },
    // see-through paper tape holding each photo on at two corners
    tape(ctx, g, rng, u) {
      const colours = ["rgba(244,183,203,0.78)", "rgba(190,208,240,0.78)", "rgba(250,226,160,0.78)", "rgba(196,226,205,0.78)"];
      corners(g, (i) => (i % 2 ? [[0.02, 0.03], [0.98, 0.97]] : [[0.98, 0.03], [0.02, 0.97]])).forEach((p, i) => {
        const left = p.x < g.slots[p.i].x + g.slots[p.i].w / 2, top = p.y < g.slots[p.i].y + g.slots[p.i].h / 2;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((left === top ? -1 : 1) * (0.7 + (rng() - 0.5) * 0.2));
        const w = u * 3.4, h = u * 1.05;
        ctx.fillStyle = colours[i % colours.length];
        ctx.shadowColor = "rgba(0,0,0,0.12)";
        ctx.shadowBlur = u * 0.15;
        ctx.beginPath();   // torn (zig-zag) ends
        ctx.moveTo(-w / 2, -h / 2);
        ctx.lineTo(w / 2, -h / 2);
        for (let k = 0; k <= 4; k++) ctx.lineTo(w / 2 + (k % 2 ? -h * 0.08 : 0), -h / 2 + (h * k) / 4);
        ctx.lineTo(-w / 2, h / 2);
        for (let k = 4; k >= 0; k--) ctx.lineTo(-w / 2 + (k % 2 ? h * 0.08 : 0), -h / 2 + (h * k) / 4);
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.fillStyle = "rgba(255,255,255,0.35)";   // printed stripes
        for (let k = -w / 2 + h * 0.2; k < w / 2; k += h * 0.5) ctx.fillRect(k, -h / 2, h * 0.18, h);
        ctx.restore();
      });
    },
    // hand-drawn white doodles: hearts, stars, squiggles, little bursts
    doodles(ctx, g, rng, u, dark) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(2, u * 0.15);
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.shadowColor = "rgba(60,30,50,0.45)";
      ctx.shadowBlur = u * 0.2;
      freeSpots(g, rng, Math.round((g.width * g.height) / (u * u) * 0.03), u * 2.2).forEach((p, i) => {
        const s = u * (1.2 + rng() * 0.6);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((rng() - 0.5) * 0.8);
        ctx.beginPath();
        const kind = i % 5;
        if (kind === 0) {   // heart outline
          ctx.moveTo(0, s * 0.35);
          ctx.bezierCurveTo(-s * 0.62, -s * 0.08, -s * 0.38, -s * 0.7, 0, -s * 0.32);
          ctx.bezierCurveTo(s * 0.38, -s * 0.7, s * 0.62, -s * 0.08, 0, s * 0.35);
        } else if (kind === 1) {   // star outline
          for (let k = 0; k <= 10; k++) {
            const a = -Math.PI / 2 + (k * Math.PI) / 5, d = k % 2 ? s * 0.22 : s * 0.5;
            ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
          }
        } else if (kind === 2) {   // squiggle
          ctx.moveTo(-s * 0.6, 0);
          for (let k = 1; k <= 4; k++) ctx.quadraticCurveTo(-s * 0.6 + s * 0.3 * (k - 0.5), (k % 2 ? -1 : 1) * s * 0.3, -s * 0.6 + s * 0.3 * k, 0);
        } else if (kind === 3) {   // burst
          for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4;
            ctx.moveTo(Math.cos(a) * s * 0.15, Math.sin(a) * s * 0.15);
            ctx.lineTo(Math.cos(a) * s * 0.45, Math.sin(a) * s * 0.45);
          }
        } else {   // swirl
          for (let a = 0; a < Math.PI * 4; a += 0.2) ctx.lineTo(Math.cos(a) * a * s * 0.04, Math.sin(a) * a * s * 0.04);
        }
        ctx.stroke();
        ctx.restore();
      });
    },
    butterfly(ctx, g, rng, u, dark) {
      const sets = dark
        ? [["#ffffff", "#cfd8ff", "#e9e6ff"], ["#ffe3ef", "#f7a8c6", "#ffffff"]]
        : [["#bcd2fb", "#7f9fe6", "#4c5f8f"], ["#fbd0e0", "#ee8fb1", "#8a4a62"], ["#e2d3fa", "#a98fe0", "#5c4a85"]];
      ctx.shadowColor = "rgba(40,40,80,0.25)";
      ctx.shadowBlur = u * 0.25;
      freeSpots(g, rng, Math.round((g.width * g.height) / (u * u) * 0.018), u * 1.8).forEach((p, i) =>
        butterflyShape(ctx, p.x, p.y, u * (1.0 + rng() * 0.8), (rng() - 0.5) * 0.9, sets[i % sets.length]));
    },
    // fine shimmering dust, with a few tiny sparkles
    glitter(ctx, g, rng, u, dark) {
      const colours = dark ? ["#fff6d8", "#f6d36b", "#ffffff"] : ["#d9ae4f", "#f0cf7a", "#ffffff", "#e9b7c6"];
      ctx.shadowColor = dark ? "rgba(255,240,200,0.9)" : "rgba(214,168,76,0.55)";
      freeSpots(g, rng, Math.round((g.width * g.height) / (u * u) * 0.45), u * 0.22).forEach((p, i) => {
        ctx.fillStyle = colours[i % colours.length];
        if (i % 17 === 0) {
          ctx.shadowBlur = u * 0.3;
          sparkleShape(ctx, p.x, p.y, u * 0.35);
        } else {
          ctx.shadowBlur = u * 0.08;
          ctx.beginPath();
          ctx.arc(p.x, p.y, u * (0.03 + rng() * 0.07), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    },
    // orange "disposable camera" date in the corner of every photo
    datestamp(ctx, g) {
      const d = new Date();
      const text = "'" + String(d.getFullYear()).slice(2) + " " + String(d.getMonth() + 1).padStart(2, "0") + " " + String(d.getDate()).padStart(2, "0");
      g.slots.forEach((s) => {
        const size = Math.max(10, Math.min(s.w, s.h) * 0.075);
        ctx.font = `bold ${size}px "Courier New", ui-monospace, monospace`;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "#ff9a3c";
        ctx.shadowColor = "rgba(255,110,30,0.9)";
        ctx.shadowBlur = size * 0.35;
        ctx.fillText(text, s.x + s.w - size * 0.8, s.y + s.h - size * 0.6);
      });
    },
    // film grain over everything, plus a soft dark edge on each photo
    grain(ctx, g) {
      g.slots.forEach((s) => {
        const r = Math.max(s.w, s.h) * 0.75;
        const grad = ctx.createRadialGradient(s.x + s.w / 2, s.y + s.h / 2, r * 0.45, s.x + s.w / 2, s.y + s.h / 2, r);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, "rgba(0,0,0,0.32)");
        ctx.fillStyle = grad;
        ctx.fillRect(s.x, s.y, s.w, s.h);
      });
      grain(ctx, g.width, g.height, 0.22);
    },
    // warm film light coming in from two corners
    leak(ctx, g, rng) {
      ctx.globalCompositeOperation = "screen";
      const big = Math.max(g.width, g.height);
      [[0, 0, "255,150,70", 0.75], [g.width, g.height * (0.55 + rng() * 0.3), "255,90,140", 0.55]].forEach(([x, y, c, a]) => {
        const grad = ctx.createRadialGradient(x, y, 0, x, y, big * 0.6);
        grad.addColorStop(0, `rgba(${c},${a})`);
        grad.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, g.width, g.height);
      });
    },
  };

  // g = { width, height, slots }, colour = an entry of COLOURS
  // unit = shape size (default: a 20th of the print's width)
  function apply(ctx, g, effectId, colour, seed, unit) {
    if (!draw[effectId]) return;
    const u = unit || Math.max(g.width, g.height * 0.6) / 20;
    ctx.save();
    draw[effectId](ctx, g, seeded(seed + ":" + effectId), u, isDark(colour.bg));
    ctx.restore();
  }

  // The paper: plain colour, gradient (+ fine grain) or a pattern
  function paper(ctx, w, h, c) {
    if (c.bg2) {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, c.bg);
      if (c.bg3) { grad.addColorStop(0.5, c.bg2); grad.addColorStop(1, c.bg3); }
      else grad.addColorStop(1, c.bg2);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = c.bg;
    }
    ctx.fillRect(0, 0, w, h);

    if (c.pattern) {
      const cell = Math.max(w, h * 0.6) / 16;
      ctx.save();
      ctx.fillStyle = c.pat;
      if (c.pattern === "gingham") {   // see-through stripes both ways: darker where they cross
        ctx.globalAlpha = 0.42;
        for (let x = 0; x < w; x += cell * 2) ctx.fillRect(x, 0, cell, h);
        for (let y = 0; y < h; y += cell * 2) ctx.fillRect(0, y, w, cell);
      } else if (c.pattern === "dots") {
        for (let y = cell / 2, row = 0; y < h + cell; y += cell, row++) {
          for (let x = (row % 2 ? cell : cell / 2); x < w + cell; x += cell) {
            ctx.beginPath();
            ctx.arc(x, y, cell * 0.17, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (c.pattern === "checker") {
        for (let y = 0, row = 0; y < h; y += cell, row++) {
          for (let x = (row % 2) * cell; x < w; x += cell * 2) ctx.fillRect(x, y, cell, cell);
        }
      }
      ctx.restore();
    }
    if (c.bg2) grain(ctx, w, h, 0.07);
  }

  return { apply, paper };
})();
