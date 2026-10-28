// =========================================================
//  QR codes with soft rounded dots (slideshow + table card).
//  The code itself comes from js/vendor/qrcode.js (MIT licence).
// =========================================================

// Draw a QR code for `text` into a square (x, y, size) on a canvas.
// Leave a white margin around it yourself - phones need it to scan.
function drawQR(ctx, text, x, y, size, color = "#2a1f22") {
  const qr = qrcode(0, "M");   // 0 = smallest size that fits, M = survives a little damage
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cell = size / n;

  // The three big corner squares (how phones find the code)
  const corners = [[0, 0], [n - 7, 0], [0, n - 7]];
  const inCorner = (r, c) => corners.some(([cr, cc]) => r >= cr && r < cr + 7 && c >= cc && c < cc + 7);

  ctx.save();
  ctx.fillStyle = color;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c) || inCorner(r, c)) continue;
      rounded(ctx, x + c * cell + cell * 0.08, y + r * cell + cell * 0.08, cell * 0.84, cell * 0.84, cell * 0.32);
      ctx.fill();
    }
  }
  corners.forEach(([r, c]) => {
    const cx = x + c * cell, cy = y + r * cell;
    rounded(ctx, cx, cy, cell * 7, cell * 7, cell * 2);
    rounded(ctx, cx + cell, cy + cell, cell * 5, cell * 5, cell * 1.4, true);   // ring = outer minus inner
    ctx.fill("evenodd");
    rounded(ctx, cx + cell * 2, cy + cell * 2, cell * 3, cell * 3, cell * 0.9);
    ctx.fill();
  });
  ctx.restore();
}

// A QR code as a ready-made canvas element (CSS size in px)
function qrCanvas(text, size, color) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.round(size * dpr);
  canvas.style.width = canvas.style.height = size + "px";
  drawQR(canvas.getContext("2d"), text, 0, 0, canvas.width, color);
  return canvas;
}

// Rounded rectangle path. keepPath = add to the current path (for rings)
function rounded(ctx, x, y, w, h, r, keepPath) {
  if (!keepPath) ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
