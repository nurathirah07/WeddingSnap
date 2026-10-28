// =========================================================
//  Filters
//  iPhone Safari doesn't support ctx.filter on canvas, so we do it
//  ourselves: each CSS filter step is turned into a 3x4 colour matrix
//  (the same maths the browser uses), then applied pixel by pixel.
// =========================================================

// CSS string for the live <video> preview, e.g. "grayscale(1) contrast(1.35)"
// CSS has no "tint" or "fade", so the live preview gets the nearest CSS
// look; the saved photo uses the exact maths below.
function filterToCss(filter) {
  if (!filter.ops.length) return "none";
  return filter.ops
    .map(([op, v]) => {
      if (op === "hue-rotate") return `${op}(${v}deg)`;
      if (op === "fade") return `contrast(${1 - v})`;
      if (op === "tint") return v[0] > v[2] ? `sepia(${Math.min(0.3, v[0] - v[2]).toFixed(2)})` : "";
      return `${op}(${v})`;
    })
    .filter(Boolean)
    .join(" ") || "none";
}

// Matrix for one step. Rows = new R, G, B. Columns = old R, G, B, offset.
function opMatrix(op, v) {
  const a = 1 - v;
  switch (op) {
    case "grayscale": return [
      [0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a, 0],
      [0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a, 0],
      [0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a, 0],
    ];
    case "sepia": return [
      [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a, 0],
      [0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a, 0],
      [0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a, 0],
    ];
    case "saturate": return [
      [0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v, 0],
      [0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v, 0],
      [0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v, 0],
    ];
    case "hue-rotate": {
      const r = v * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      return [
        [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0],
        [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0],
        [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0],
      ];
    }
    case "brightness": return [[v, 0, 0, 0], [0, v, 0, 0], [0, 0, v, 0]];
    case "contrast": {
      const o = (0.5 - 0.5 * v) * 255;
      return [[v, 0, 0, o], [0, v, 0, o], [0, 0, v, o]];
    }
    // Colour cast: ["tint", [red, green, blue]] multipliers, e.g. [1.06, 1, 0.94] = warmer
    case "tint": return [[v[0], 0, 0, 0], [0, v[1], 0, 0], [0, 0, v[2], 0]];
    // Faded / matte: blacks lift to dark grey, whites dip slightly
    case "fade": return [[1 - v, 0, 0, v * 160], [0, 1 - v, 0, v * 160], [0, 0, 1 - v, v * 160]];
  }
  throw new Error("Unknown filter step: " + op);
}

// Apply matrix B after matrix A (B x A)
function combine(A, B) {
  const out = [];
  for (let r = 0; r < 3; r++) {
    out.push([0, 1, 2, 3].map((c) =>
      B[r][0] * A[0][c] + B[r][1] * A[1][c] + B[r][2] * A[2][c] + (c === 3 ? B[r][3] : 0)
    ));
  }
  return out;
}

// Returns a NEW canvas with the filter applied to `source`
function applyFilter(source, filter) {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const octx = out.getContext("2d");
  octx.drawImage(source, 0, 0);
  if (!filter.ops.length) return out;

  const identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
  const m = filter.ops.reduce((acc, [op, v]) => combine(acc, opMatrix(op, v)), identity);

  const img = octx.getImageData(0, 0, out.width, out.height);
  const d = img.data;   // [r,g,b,a, r,g,b,a, ...]  (values clamp to 0-255 automatically)
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i]     = m[0][0] * r + m[0][1] * g + m[0][2] * b + m[0][3];
    d[i + 1] = m[1][0] * r + m[1][1] * g + m[1][2] * b + m[1][3];
    d[i + 2] = m[2][0] * r + m[2][1] * g + m[2][2] * b + m[2][3];
  }
  octx.putImageData(img, 0, 0);
  return out;
}
