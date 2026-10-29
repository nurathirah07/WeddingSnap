// =========================================================
//  Stickers guests place on their photo (edit screen → Stickers).
//  Each one is drawn with code at any size: `draw(ctx)` draws it centred
//  on (0, 0), `aspect` wide and 1 tall. The app scales and turns it.
// =========================================================
const STICKERS = (() => {
  const SCRIPT = '"Runethia", Georgia, serif';
  const DISPLAY = '"Runiga", Georgia, serif';
  const SERIF = '"Orange Avenue", Georgia, serif';

  function rounded(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Text that fits a width, centred on (x, y)
  function text(ctx, str, x, y, maxW, size, font, fill) {
    ctx.font = `${size}px ${font}`;
    const scale = Math.min(1, maxW / ctx.measureText(str).width);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = fill;
    ctx.fillText(str, 0, 0);
    ctx.restore();
  }
  function heartPath(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, 0.35 * s);
    ctx.bezierCurveTo(-0.62 * s, -0.08 * s, -0.38 * s, -0.7 * s, 0, -0.32 * s);
    ctx.bezierCurveTo(0.38 * s, -0.7 * s, 0.62 * s, -0.08 * s, 0, 0.35 * s);
  }
  // Shadows are measured in screen pixels (they ignore ctx.scale), so turn
  // sticker units into pixels at the current size
  const px = (ctx, v) => { const m = ctx.getTransform(); return v * Math.hypot(m.a, m.b); };
  const shadow = (ctx, colour, blur, y) => { ctx.shadowColor = colour; ctx.shadowBlur = px(ctx, blur); ctx.shadowOffsetY = px(ctx, y); };
  const soft = (ctx) => shadow(ctx, "rgba(40,20,30,0.28)", 0.06, 0.025);
  const noShadow = (ctx) => { ctx.shadowColor = "transparent"; };

  return [
    { id: "tahniah", name: "Tahniah!", aspect: 1.7, draw(ctx) {
      soft(ctx);
      ctx.fillStyle = "#fff";
      rounded(ctx, -0.8, -0.42, 1.6, 0.7, 0.3);
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(-0.3, 0.2); ctx.lineTo(-0.48, 0.5); ctx.lineTo(-0.05, 0.25); ctx.fill();   // tail
      noShadow(ctx);
      text(ctx, "Tahniah!", 0, -0.06, 1.4, 0.42, SCRIPT, "#d6456e");
    } },
    { id: "spb", name: "Selamat Pengantin Baru", aspect: 3.2, draw(ctx) {
      soft(ctx);
      // ribbon: folded ends behind, band in front
      ctx.fillStyle = "#c95a7d";
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.moveTo(side * 1.25, -0.2); ctx.lineTo(side * 1.6, -0.2); ctx.lineTo(side * 1.48, 0.06);
        ctx.lineTo(side * 1.6, 0.32); ctx.lineTo(side * 1.25, 0.32); ctx.closePath(); ctx.fill();
      });
      ctx.fillStyle = "#e9799c";
      rounded(ctx, -1.35, -0.32, 2.7, 0.56, 0.06);
      ctx.fill();
      noShadow(ctx);
      text(ctx, "Selamat Pengantin Baru", 0, -0.03, 2.45, 0.27, SERIF, "#fff");
    } },
    { id: "married", name: "Just Married", aspect: 2.1, draw(ctx) {
      soft(ctx);
      ctx.fillStyle = "#fffaf6";
      rounded(ctx, -1, -0.4, 2, 0.8, 0.14);
      ctx.fill();
      noShadow(ctx);
      ctx.strokeStyle = "#2a1f22";
      ctx.lineWidth = 0.035;
      rounded(ctx, -0.93, -0.33, 1.86, 0.66, 0.1);
      ctx.stroke();
      text(ctx, "Just Married", 0, 0.02, 1.65, 0.34, DISPLAY, "#2a1f22");
    } },
    { id: "love", name: "Love you!", aspect: 1.5, draw(ctx) {
      soft(ctx);
      ctx.fillStyle = "#f6b3c8";
      ctx.beginPath(); ctx.ellipse(0, -0.05, 0.72, 0.38, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0.25, 0.22); ctx.lineTo(0.45, 0.5); ctx.lineTo(0.02, 0.3); ctx.fill();
      noShadow(ctx);
      text(ctx, "Love you!", 0, -0.06, 1.2, 0.34, SCRIPT, "#8a2846");
    } },
    { id: "bestday", name: "Best Day Ever", aspect: 2.4, draw(ctx) {
      ctx.font = `0.5px ${DISPLAY}`;
      const scale = Math.min(1, 2.2 / ctx.measureText("Best Day Ever").width);
      ctx.save();
      ctx.scale(scale, scale);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      shadow(ctx, "rgba(40,20,30,0.3)", 0.06, 0.03);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 0.14;
      ctx.strokeText("Best Day Ever", 0, 0);
      noShadow(ctx);
      ctx.fillStyle = "#e0567a";
      ctx.fillText("Best Day Ever", 0, 0);
      ctx.restore();
    } },
    { id: "heart", name: "Heart", aspect: 1.2, draw(ctx) {
      soft(ctx);
      heartPath(ctx, 1.25);
      const g = ctx.createLinearGradient(0, -0.5, 0, 0.5);
      g.addColorStop(0, "#ff6b8f"); g.addColorStop(1, "#d6264f");
      ctx.fillStyle = g;
      ctx.fill();
      noShadow(ctx);
      ctx.fillStyle = "rgba(255,255,255,0.55)";   // shine
      ctx.beginPath(); ctx.ellipse(-0.26, -0.22, 0.1, 0.06, -0.6, 0, Math.PI * 2); ctx.fill();
    } },
    { id: "crown", name: "Crown", aspect: 1.4, draw(ctx) {
      soft(ctx);
      const g = ctx.createLinearGradient(0, -0.45, 0, 0.4);
      g.addColorStop(0, "#ffe08a"); g.addColorStop(1, "#d9a03a");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-0.6, 0.35); ctx.lineTo(-0.66, -0.25); ctx.lineTo(-0.32, 0.02); ctx.lineTo(0, -0.42);
      ctx.lineTo(0.32, 0.02); ctx.lineTo(0.66, -0.25); ctx.lineTo(0.6, 0.35); ctx.closePath();
      ctx.fill();
      noShadow(ctx);
      [[-0.66, -0.28], [0, -0.46], [0.66, -0.28]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 0.07, 0, Math.PI * 2); ctx.fill(); });
      ["#e0567a", "#7f9be0", "#e0567a"].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(-0.3 + i * 0.3, 0.2, 0.06, 0, Math.PI * 2); ctx.fill(); });
    } },
    { id: "shades", name: "Heart shades", aspect: 2.4, draw(ctx) {
      soft(ctx);
      ctx.strokeStyle = "#2a1f22"; ctx.lineWidth = 0.07; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-0.22, -0.08); ctx.quadraticCurveTo(0, -0.22, 0.22, -0.08); ctx.stroke();   // bridge
      ctx.beginPath(); ctx.moveTo(-1.1, -0.15); ctx.lineTo(-0.85, -0.12); ctx.moveTo(1.1, -0.15); ctx.lineTo(0.85, -0.12); ctx.stroke();
      [-0.55, 0.55].forEach((x) => {
        ctx.save();
        ctx.translate(x, 0.02);
        heartPath(ctx, 0.95);
        ctx.fillStyle = "#ff5c8a";
        ctx.fill();
        ctx.lineWidth = 0.05; ctx.strokeStyle = "#2a1f22"; ctx.stroke();
        ctx.restore();
      });
      noShadow(ctx);
    } },
    { id: "songkok", name: "Songkok", aspect: 1.7, draw(ctx) {
      soft(ctx);
      const g = ctx.createLinearGradient(-0.8, 0, 0.8, 0);
      g.addColorStop(0, "#1a1618"); g.addColorStop(0.45, "#3a3236"); g.addColorStop(1, "#141113");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-0.72, 0.38); ctx.lineTo(-0.62, -0.3);
      ctx.quadraticCurveTo(0, -0.46, 0.62, -0.3);
      ctx.lineTo(0.72, 0.38);
      ctx.quadraticCurveTo(0, 0.48, -0.72, 0.38);
      ctx.fill();
      noShadow(ctx);
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 0.025;   // velvet seam
      ctx.beginPath(); ctx.moveTo(-0.66, 0.0); ctx.quadraticCurveTo(0, -0.12, 0.66, 0.0); ctx.stroke();
    } },
    { id: "flower", name: "Flower", aspect: 1, draw(ctx) {
      soft(ctx);
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI * 2) / 5);
        const g = ctx.createLinearGradient(0, 0, 0, -0.48);
        g.addColorStop(0, "#f7a6c1"); g.addColorStop(1, "#fde3ec");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(0, -0.26, 0.17, 0.25, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      noShadow(ctx);
      ctx.fillStyle = "#f6c94a";
      ctx.beginPath(); ctx.arc(0, 0, 0.12, 0, Math.PI * 2); ctx.fill();
    } },
    { id: "ring", name: "Ring", aspect: 0.9, draw(ctx) {
      soft(ctx);
      ctx.strokeStyle = "#e3b955"; ctx.lineWidth = 0.09;
      ctx.beginPath(); ctx.arc(0, 0.16, 0.3, 0, Math.PI * 2); ctx.stroke();
      noShadow(ctx);
      ctx.fillStyle = "#d8f0ff";
      ctx.beginPath(); ctx.moveTo(-0.2, -0.22); ctx.lineTo(-0.1, -0.36); ctx.lineTo(0.1, -0.36); ctx.lineTo(0.2, -0.22); ctx.lineTo(0, -0.04); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#9fc6e3"; ctx.lineWidth = 0.02; ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.moveTo(-0.07, -0.33); ctx.lineTo(0.03, -0.33); ctx.lineTo(-0.03, -0.22); ctx.closePath(); ctx.fill();
    } },
    { id: "kiss", name: "Kiss", aspect: 1.5, draw(ctx) {
      soft(ctx);
      ctx.fillStyle = "#d6264f";
      ctx.beginPath();   // top lip
      ctx.moveTo(-0.66, 0.02);
      ctx.bezierCurveTo(-0.4, -0.38, -0.12, -0.34, 0, -0.18);
      ctx.bezierCurveTo(0.12, -0.34, 0.4, -0.38, 0.66, 0.02);
      ctx.bezierCurveTo(0.3, 0.0, -0.3, 0.0, -0.66, 0.02);
      ctx.fill();
      ctx.beginPath();   // bottom lip
      ctx.moveTo(-0.62, 0.06);
      ctx.bezierCurveTo(-0.3, 0.12, 0.3, 0.12, 0.62, 0.06);
      ctx.bezierCurveTo(0.4, 0.42, -0.4, 0.42, -0.62, 0.06);
      ctx.fill();
      noShadow(ctx);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath(); ctx.ellipse(-0.18, 0.22, 0.12, 0.04, 0.1, 0, Math.PI * 2); ctx.fill();
    } },
    { id: "sparkle", name: "Sparkle", aspect: 1, draw(ctx) {
      shadow(ctx, "rgba(214,168,76,0.7)", 0.12, 0);
      [[0, 0, 0.46, "#f0c95c"], [0.33, -0.3, 0.15, "#ffffff"], [-0.3, 0.3, 0.1, "#f6dc8f"]].forEach(([x, y, r, c]) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.quadraticCurveTo(x + r * 0.12, y - r * 0.12, x + r, y);
        ctx.quadraticCurveTo(x + r * 0.12, y + r * 0.12, x, y + r);
        ctx.quadraticCurveTo(x - r * 0.12, y + r * 0.12, x - r, y);
        ctx.quadraticCurveTo(x - r * 0.12, y - r * 0.12, x, y - r);
        ctx.fill();
      });
    } },
    { id: "bow", name: "Bow", aspect: 1.5, draw(ctx) {
      soft(ctx);
      ctx.fillStyle = "#f2a7bf";
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(side * 0.3, -0.5, side * 0.75, -0.42, side * 0.7, 0);
        ctx.bezierCurveTo(side * 0.66, 0.32, side * 0.3, 0.24, 0, 0);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(side * 0.05, 0.05); ctx.lineTo(side * 0.42, 0.5); ctx.lineTo(side * 0.24, 0.44); ctx.lineTo(side * 0.02, 0.1);
        ctx.fill();
      });
      noShadow(ctx);
      ctx.fillStyle = "#d97f9c";
      ctx.beginPath(); ctx.ellipse(0, 0, 0.12, 0.15, 0, 0, Math.PI * 2); ctx.fill();
    } },
  ];
})();

// Draw one sticker into a box of `height` px, centred at (x, y), turned `angle`
function drawSticker(ctx, sticker, x, y, height, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(height, height);
  sticker.draw(ctx);
  ctx.restore();
}

// A sticker on its own canvas (for the picker and the drag-around layer)
function stickerImage(sticker, height) {
  const pad = height * 0.12;
  const c = document.createElement("canvas");
  c.width = Math.ceil(height * sticker.aspect + pad * 2);
  c.height = Math.ceil(height + pad * 2);
  drawSticker(c.getContext("2d"), sticker, c.width / 2, c.height / 2, height);
  return c;
}
