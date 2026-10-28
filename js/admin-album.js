// =========================================================
//  Admin page, part 2 (no GitHub needed):
//  - Photos & wishes: hide / show / delete any guest photo and read
//    every wish. Uses the ADMIN_KEY set in the Apps Script.
//  - Table card: a printable card with a QR code to the photobooth.
// =========================================================
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY_STORE = "weddingsnap.admin.albumKey";
  const thumbUrl = (id, size) => `https://drive.google.com/thumbnail?id=${id}&sz=w${size}`;
  const driveLink = (id) => `https://drive.google.com/file/d/${id}/view`;

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // =========================================================
  //  Photos & wishes
  // =========================================================
  let key = localStorage.getItem(KEY_STORE) || "";
  let photos = [];
  let view = "photos";

  async function call(action, extra = {}) {
    if (!CONFIG.SCRIPT_URL) throw new Error("The album isn't connected (SCRIPT_URL in js/config.js)");
    // text/plain body = no CORS preflight, which Apps Script can't answer
    const res = await fetch(CONFIG.SCRIPT_URL, { method: "POST", body: JSON.stringify({ action, key, ...extra }) });
    const data = await res.json();
    if (!data.ok) {
      if (data.error === "Unknown action") {
        throw new Error("Your Apps Script is the old version. Paste the new apps-script/Code.gs into it and deploy a new version (see README).");
      }
      throw new Error(data.error);
    }
    return data;
  }

  async function openAlbum() {
    $("albumError").textContent = "";
    $("albumConnect").disabled = true;
    try {
      photos = (await call("adminList")).photos;
      localStorage.setItem(KEY_STORE, key);
      $("albumLogin").classList.add("hidden");
      $("albumView").classList.remove("hidden");
      renderAlbum();
    } catch (err) {
      $("albumError").textContent = err.message;
      if (/admin key/i.test(err.message)) localStorage.removeItem(KEY_STORE);
    }
    $("albumConnect").disabled = false;
  }

  const fmtWhen = (t) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  function renderAlbum() {
    const wishes = photos.filter((p) => p.wish || p.name);
    const hidden = photos.filter((p) => p.hidden).length;
    $("nPhotos").textContent = photos.length;
    $("albumCard").querySelector(".albumTabs .tab").title = hidden ? hidden + " hidden" : "";
    $("nWishes").textContent = wishes.length;
    $("albumGrid").classList.toggle("hidden", view !== "photos");
    $("wishList").classList.toggle("hidden", view !== "wishes");

    const grid = $("albumGrid");
    grid.replaceChildren();
    if (!photos.length) grid.textContent = "No photos yet.";
    photos.forEach((p) => {
      const card = document.createElement("div");
      card.className = "albumItem" + (p.hidden ? " isHidden" : "");
      const a = document.createElement("a");
      a.href = driveLink(p.id);
      a.target = "_blank";
      const img = document.createElement("img");
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.src = thumbUrl(p.id, 400);
      img.alt = "";
      a.appendChild(img);
      if (p.hidden) {
        const tag = document.createElement("span");
        tag.className = "albumTag";
        tag.textContent = "Hidden";
        a.appendChild(tag);
      }
      const info = document.createElement("div");
      info.className = "albumInfo";
      const when = document.createElement("small");
      when.textContent = fmtWhen(p.time) + (p.name ? " · " + p.name : "");
      info.appendChild(when);
      if (p.wish) {
        const w = document.createElement("p");
        w.textContent = "“" + p.wish + "”";
        info.appendChild(w);
      }
      const actions = document.createElement("div");
      actions.className = "row left";
      const hide = document.createElement("button");
      hide.className = "btn ghost small";
      hide.textContent = p.hidden ? "Show" : "Hide";
      hide.title = p.hidden ? "Show it in the gallery and slideshow again" : "Take it out of the gallery and slideshow (kept in Drive)";
      hide.onclick = () => setHidden(p, !p.hidden, hide);
      const del = document.createElement("button");
      del.className = "btn link danger";
      del.textContent = "Delete";
      del.onclick = () => remove(p, del);
      actions.append(hide, del);
      card.append(a, info, actions);
      grid.appendChild(card);
    });

    const list = $("wishList");
    list.replaceChildren();
    if (!wishes.length) list.textContent = "No wishes yet.";
    wishes.forEach((p) => {
      const li = document.createElement("li");
      const img = document.createElement("img");
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.src = thumbUrl(p.id, 160);
      img.alt = "";
      const text = document.createElement("div");
      const w = document.createElement("p");
      w.textContent = p.wish ? "“" + p.wish + "”" : "(no message)";
      const by = document.createElement("small");
      by.textContent = (p.name || "Someone") + " · " + fmtWhen(p.time) + (p.hidden ? " · hidden photo" : "");
      text.append(w, by);
      li.append(img, text);
      list.appendChild(li);
    });
  }

  async function setHidden(p, hidden, btn) {
    btn.disabled = true;
    try {
      await call("adminHide", { id: p.id, hidden });
      p.hidden = hidden;
      toast(hidden ? "Hidden from the gallery and slideshow" : "Visible again");
      renderAlbum();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  }

  async function remove(p, btn) {
    if (!confirm("Delete this photo for everyone? It goes to the Drive bin (you can restore it from there for 30 days).")) return;
    btn.disabled = true;
    try {
      await call("adminDelete", { id: p.id });
      photos = photos.filter((x) => x !== p);
      toast("Photo deleted");
      renderAlbum();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  }

  // Wishes as a spreadsheet (opens in Excel / Google Sheets)
  function downloadWishes() {
    const cell = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const rows = [["Time", "Name", "Wish", "Photo"]].concat(
      photos.filter((p) => p.wish || p.name).slice().reverse()
        .map((p) => [new Date(p.time).toLocaleString(), p.name, p.wish, driveLink(p.id)])
    );
    const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");   // BOM = Excel reads é, ñ… right
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "wedding-wishes.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  $("albumConnect").addEventListener("click", () => { key = $("adminKey").value.trim(); if (key) openAlbum(); });
  $("adminKey").addEventListener("keydown", (e) => { if (e.key === "Enter") $("albumConnect").click(); });
  $("albumRefresh").addEventListener("click", openAlbum);
  $("wishCsv").addEventListener("click", downloadWishes);
  $("albumLock").addEventListener("click", () => {
    localStorage.removeItem(KEY_STORE);
    key = "";
    $("adminKey").value = "";
    $("albumView").classList.add("hidden");
    $("albumLogin").classList.remove("hidden");
  });
  document.querySelectorAll(".albumTabs .tab").forEach((tab) => tab.addEventListener("click", () => {
    view = tab.dataset.view;
    document.querySelectorAll(".albumTabs .tab").forEach((t) => t.classList.toggle("active", t === tab));
    renderAlbum();
  }));
  if (key && location.protocol !== "file:") openAlbum();

  // =========================================================
  //  Table card with a QR code (A6, 300 dpi)
  // =========================================================
  const card = $("tableCard");
  const W = card.width, H = card.height;
  let details = { title: CONFIG.TITLE, couple: CONFIG.COUPLE, date: CONFIG.DATE };

  $("qrLink").value = new URL("./", location.href).href;

  // The wedding details: what's typed in the Wedding details card (after
  // connecting GitHub), otherwise what's live in settings.json
  function currentDetails() {
    const typed = (id) => ($(id) && $(id).value.trim()) || "";
    return {
      title: typed("setTitle") || details.title,
      couple: typed("setCouple") || details.couple,
      date: typed("setDate") || details.date,
    };
  }

  function spaced(ctx, text, x, y, spacing) {
    if ("letterSpacing" in ctx) {
      ctx.letterSpacing = spacing + "px";
      ctx.fillText(text, x, y);
      ctx.letterSpacing = "0px";
      return;
    }
    ctx.fillText(text.split("").join(String.fromCharCode(8202)), x, y);   // older browsers: hair spaces
  }

  function fit(ctx, text, x, y, maxW, size, font) {
    do { ctx.font = font.replace("{size}", size + "px"); size -= 2; } while (ctx.measureText(text).width > maxW && size > 10);
    ctx.fillText(text, x, y);
  }

  function drawCard() {
    const d = currentDetails();
    const ctx = card.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    // Soft pink / lilac / blue, like the album cover in the app
    let g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#f2a9cb");
    g.addColorStop(0.5, "#c9b0de");
    g.addColorStop(1, "#9aaee0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    [[0.25, 0.18, 0.55, "238,119,173"], [0.85, 0.35, 0.5, "152,170,226"], [0.2, 0.78, 0.5, "180,138,200"],
     [0.8, 0.88, 0.45, "238,119,173"], [0.55, 0.55, 0.4, "248,198,220"]].forEach(([x, y, r, rgb]) => {
      g = ctx.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * W);
      g.addColorStop(0, `rgba(${rgb},0.75)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    });

    // thin inner border
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    rounded(ctx, 46, 46, W - 92, H - 92, 30);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(90,50,90,0.28)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 3;

    ctx.font = '500 34px "DM Sans", sans-serif';
    spaced(ctx, "WELCOME TO OUR", W / 2, 190, 10);
    fit(ctx, d.title, W / 2, 300, W - 220, 116, '400 {size} "Runiga", Georgia, serif');

    const initials = d.couple.split(/\s*&\s*|\s+(?:and|dan)\s+/i)
      .map((n) => n.trim().charAt(0).toUpperCase()).filter(Boolean).join(" & ");
    fit(ctx, initials, W / 2, 540, W - 300, 250, '400 {size} "Runethia", Georgia, serif');

    // QR code on a white card
    const box = 560, bx = (W - box) / 2, by = 720;
    ctx.shadowColor = "rgba(70,40,80,0.25)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = "#fffaf7";
    rounded(ctx, bx, by, box, box, 44);
    ctx.fill();
    ctx.shadowColor = "transparent";
    drawQR(ctx, $("qrLink").value.trim() || location.href, bx + 60, by + 60, box - 120, "#2a1f22");

    ctx.shadowColor = "rgba(90,50,90,0.28)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = "#fff";
    fit(ctx, $("qrLine").value.trim(), W / 2, 1385, W - 260, 54, '400 {size} "Orange Avenue", Georgia, serif');
    fit(ctx, d.couple, W / 2, 1505, W - 260, 92, '400 {size} "Runethia", Georgia, serif');
    ctx.font = '500 34px "DM Sans", sans-serif';
    spaced(ctx, d.date.toUpperCase(), W / 2, 1625, 8);
    ctx.shadowColor = "transparent";
  }

  let pending = null;
  function redraw() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(drawCard);
  }

  async function loadCardDetails() {
    try {
      const s = await (await fetch("settings.json", { cache: "no-cache" })).json();
      details = {
        title: (s.title || "").trim() || CONFIG.TITLE,
        couple: (s.couple || "").trim() || CONFIG.COUPLE,
        date: (s.date || "").trim() || CONFIG.DATE,
      };
    } catch (e) {}
    await Promise.all(['80px "Runiga"', '80px "Runethia"', '40px "Orange Avenue"', '500 30px "DM Sans"']
      .map((f) => document.fonts.load(f).catch(() => {})));
    drawCard();
  }

  ["qrLink", "qrLine", "setTitle", "setCouple", "setDate"].forEach((id) => $(id) && $(id).addEventListener("input", redraw));
  // admin.js fills in the details after connecting to GitHub (no input event)
  let lastDetails = "";
  setInterval(() => {
    const now = JSON.stringify(currentDetails());
    if (now !== lastDetails) { lastDetails = now; redraw(); }
  }, 1500);

  $("qrDownload").addEventListener("click", () => {
    drawCard();
    card.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "table-card.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  });

  // 4 cards on one A4 sheet (each A6) - cut along the gaps
  $("qrPrint").addEventListener("click", () => {
    drawCard();
    const src = card.toDataURL("image/png");
    const w = window.open("", "_blank");
    if (!w) return toast("Allow pop-ups to print");
    w.document.write(`<!DOCTYPE html><title>Table cards</title><style>
      @page { size: A4; margin: 0; }
      html, body { margin: 0; }
      .sheet { width: 210mm; height: 297mm; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
      .sheet img { width: 105mm; height: 148.5mm; object-fit: cover; }
    </style><div class="sheet">${'<img src="' + src + '">'.repeat(4)}</div>
    <script>Promise.all([...document.images].map(i => i.decode())).then(() => { print(); });<\/script>`);
    w.document.close();
  });

  loadCardDetails();
})();
