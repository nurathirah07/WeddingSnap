// =========================================================
//  Effects on the print: sparkles, hearts, stars, confetti...
//  Drawn with code (no image files), so they're sharp at any size.
//  Shapes go on the paper and the edges of the photos - never over the
//  middle of a photo (faces) or over the wedding details.
//  Positions come from a fixed "random" sequence per layout + effect,
//  so the preview and the saved photo always match.
// =========================================================
const EFFECTS = [
  { id: "none",     name: "None" },
  { id: "sparkle",  name: "Sparkles" },
  { id: "hearts",   name: "Hearts" },
  { id: "stars",    name: "Stars" },
  { id: "confetti", name: "Confetti" },
  { id: "petals",   name: "Petals" },
  { id: "bokeh",    name: "Bokeh" },
  { id: "leak",     name: "Light leak" },
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

  return { apply };
})();
