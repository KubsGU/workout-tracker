// ===== Logika aplikacji =====
const App = (() => {
  const $ = (id) => document.getElementById(id);
  const appEl = () => $("app");

  function paint(html, dir) {
    appEl().innerHTML = html;
    const c = appEl().querySelector(".content");
    if (c && dir === "fwd") c.classList.add("anim-fwd");
    else if (c && dir === "back") c.classList.add("anim-back");
    window.scrollTo(0, 0);
  }

  let state = { screen: "home", phase: "w12", workoutId: null, exIdx: 0, draft: {}, unlocked: false };
  let wakeLock = null;

  const resolve = (val, phase) =>
    (val && typeof val === "object" && ("w12" in val || "w34" in val)) ? val[phase] : val;
  const getWorkout = (id) => WORKOUTS.find((w) => w.id === id);
  function fmtDate(iso) { const d = new Date(iso); return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" }); }

  // ---------------- HAPTYKA ----------------
  const HAPTIC = { tap: 8, nav: 6, ok: [14, 45, 22], err: 70, start: 12 };
  function haptic(p) { try { if (window.navigator && navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

  // ---------------- KRYPTOGRAFIA (AES-GCM + PBKDF2) ----------------
  function b64e(buf) { const b = new Uint8Array(buf); let s = ""; const CH = 0x8000; for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH)); return btoa(s); }
  function b64d(str) { return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)); }
  async function deriveKey(password, salt, iters) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iters, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }
  async function decryptJSON(blob, password) {
    const key = await deriveKey(password, b64d(blob.salt), blob.iters || 250000);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(blob.iv) }, key, b64d(blob.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // ---------------- BOOT / EKRAN BLOKADY ----------------
  let encBlob = null;
  async function loadEnc() {
    if (encBlob) return encBlob;
    const r = await fetch("data.enc.json", { cache: "no-store" });
    if (!r.ok) throw new Error("no-data");
    encBlob = await r.json();
    return encBlob;
  }

  async function boot() {
    const pw = sessionStorage.getItem("wt_pw") || localStorage.getItem("wt_pw");
    if (pw) { try { await applyUnlock(pw); return; } catch (e) { /* przejdź do blokady */ } }
    renderLock();
  }

  function renderLock(msg) {
    appEl().innerHTML = `
      <div class="lock">
        <div class="lock-card">
          <div class="lock-logo">🏋️</div>
          <h1 class="lock-title">Mój Trening</h1>
          <p class="lock-sub">Wpisz hasło, aby odblokować</p>
          <input id="pw" class="lock-input" type="password" inputmode="text" autocomplete="current-password"
            placeholder="Hasło" onkeydown="if(event.key==='Enter')App.tryUnlock()" />
          <label class="lock-remember"><input id="rem" type="checkbox" /> Zapamiętaj na tym urządzeniu</label>
          <button class="lock-btn" onclick="App.tryUnlock()">Odblokuj</button>
          <div class="lock-msg" id="lockmsg">${msg || ""}</div>
        </div>
      </div>`;
    const i = $("pw"); if (i) i.focus();
  }

  async function tryUnlock() {
    const pwEl = $("pw"); const remEl = $("rem"); const msg = $("lockmsg");
    const pw = pwEl ? pwEl.value : "";
    if (!pw) { if (msg) msg.textContent = "Wpisz hasło"; return; }
    const btn = appEl().querySelector(".lock-btn");
    if (btn) { btn.textContent = "Odblokowywanie…"; btn.disabled = true; }
    try {
      await applyUnlock(pw);
      if (remEl && remEl.checked) localStorage.setItem("wt_pw", pw);
      else sessionStorage.setItem("wt_pw", pw);
    } catch (e) {
      haptic(HAPTIC.err);
      if (btn) { btn.textContent = "Odblokuj"; btn.disabled = false; }
      if (msg) msg.textContent = (e.message === "no-data")
        ? "Brak danych aplikacji. Uruchom setup (encrypt.html), aby utworzyć data.enc.json."
        : "Nieprawidłowe hasło";
    }
  }

  async function applyUnlock(pw) {
    const blob = await loadEnc();
    const data = await decryptJSON(blob, pw); // rzuca wyjątek przy złym haśle
    window.PHASES = data.phases;
    window.WORKOUTS = data.workouts;
    window.WEEK_SCHEDULE = data.week || [];
    window.SUPABASE_URL = data.supabaseUrl || "";
    window.SUPABASE_ANON_KEY = data.supabaseKey || "";
    state.unlocked = true;
    await init();
  }

  function lockApp() {
    sessionStorage.removeItem("wt_pw");
    localStorage.removeItem("wt_pw");
    location.reload();
  }

  // ---------------- INIT ----------------
  async function init() {
    try { await Store.init(); } catch (e) { console.error(e); }
    const savedPhase = localStorage.getItem("wt_phase");
    if (savedPhase) state.phase = savedPhase;
    renderHome();
  }

  function renderHome(dir) {
    state.screen = "home";
    releaseWake();
    const syncCls = Store.mode === "cloud" ? "sync-dot cloud" : "sync-dot";
    const syncTxt = Store.mode === "cloud" ? "Synchronizacja wł." : "Tryb lokalny";
    const cards = WORKOUTS.map((w) => {
      const last = lastWorkoutDate(w.id);
      const lastTxt = last ? `Ostatnio: ${fmtDate(last)}` : "Jeszcze nie wykonano";
      return `<button class="wcard" onclick="App.openWorkout('${w.id}')">
          <span class="bar" style="background:${w.color}"></span>
          <div class="wmeta"><div class="wname">${w.name}</div><div class="wfocus">${w.focus}</div><div class="wlast">${lastTxt}</div></div>
          <div class="chev">›</div></button>`;
    }).join("");
    paint(`<div class="topbar"><h1>Mój Trening</h1><div class="${syncCls}"><b></b>${syncTxt}</div>
        <button class="iconbtn" onclick="App.lockApp()" title="Zablokuj">🔒</button></div>
      <div class="content">
        <div class="section-label">Faza planu</div>
        <div class="segment">${PHASES.map((p) => `<button class="${p.id === state.phase ? "active" : ""}" onclick="App.setPhase('${p.id}')">${p.name}</button>`).join("")}</div>
        <div class="section-label">Wybierz trening</div>
        <div class="wlist stagger">${cards}</div>
        <div class="hint">Wskazówka: dodaj tę stronę do ekranu głównego, aby działała jak aplikacja. Stuknij ćwiczenie podczas treningu, wpisz ciężar i powtórzenia, a aplikacja zapamięta je na następny raz.</div>
      </div>`, dir);
  }

  function lastWorkoutDate(workoutId) {
    let latest = null;
    const wk = getWorkout(workoutId);
    if (!wk) return null;
    for (const ex of wk.exercises) { const l = Store.lastFor(ex.key); if (l && (!latest || l.created_at > latest)) latest = l.created_at; }
    return latest;
  }

  function setPhase(p) {
    state.phase = p;
    localStorage.setItem("wt_phase", p);
    if (state.screen === "home") renderHome("none");
    else if (state.screen === "overview") renderOverview("none");
    else renderWorkout("none");
  }

  function openWorkout(id) { haptic(HAPTIC.tap); state.workoutId = id; state.draft = {}; renderOverview("fwd"); }
  function isDoneToday(key) { const l = Store.lastFor(key); return l && l.log_date === new Date().toISOString().slice(0, 10); }

  function renderOverview(dir) {
    const w = getWorkout(state.workoutId);
    if (!w) return renderHome("back");
    state.screen = "overview";
    releaseWake();
    const phaseShort = PHASES.find((p) => p.id === state.phase).short;
    const items = w.exercises.map((ex, i) => {
      const sets = resolve(ex.sets, state.phase);
      const reps = resolve(ex.reps, state.phase);
      const done = isDoneToday(ex.key);
      let tags = "";
      if (ex.opt) tags += `<span class="tag opt">Opcjonalne</span>`;
      if (ex.group) tags += `<span class="tag grp">Łączona ${ex.group}</span>`;
      if (ex.finisher) tags += `<span class="tag fin">Wykończenie</span>`;
      const last = Store.lastFor(ex.key);
      const lastTxt = (last && last.sets && last.sets.length && !ex.timed)
        ? `<div class="ov-last">Ostatnio: ${last.sets.map(s => s.w != null && s.w !== "" ? s.w + "kg" : "—").join(" · ")}</div>` : "";
      const sub = ex.timed
        ? `<span class="chip">${sets} rund</span><span class="chip">${reps}</span>`
        : `<span class="chip">${sets} ${setsWord(sets)}</span><span class="chip">${reps} powt.</span>${ex.tempo && ex.tempo !== "—" ? `<span class="chip">tempo ${ex.tempo}</span>` : ""}${ex.rest && ex.rest !== "—" ? `<span class="chip">${ex.rest}</span>` : ""}`;
      return `<button class="ov-item ${done ? "done" : ""}" onclick="App.selectExercise(${i})">
          <div class="ov-num">${done ? "✓" : i + 1}</div>
          <div class="ov-mid"><div class="ov-name">${ex.name}</div><div class="ov-sub">${sub}</div>${tags ? `<div class="ov-tags">${tags}</div>` : ""}${lastTxt}</div>
          <div class="ov-chev">›</div></button>`;
    }).join("");
    const prehabTxt = (w.prehab && w.prehab.length)
      ? `<div class="meta">Przed treningiem: ${w.prehab.map(p => p.name.split(" (")[0]).join(", ")}</div>` : "";
    paint(`<div class="topbar"><button class="iconbtn" onclick="App.goHome()">‹</button><h1>${w.name}</h1></div>
      <div class="content">
        <div class="ov-head"><span class="bar" style="background:${w.color}"></span><div class="t">${w.name}</div><div class="f">${w.focus}</div><div class="meta">Faza: Tydzień ${phaseShort} · ${w.exercises.length} ćwiczeń</div>${prehabTxt}</div>
        <div class="section-label">Plan ćwiczeń — stuknij, aby zacząć</div>
        <div class="ov-list stagger">${items}</div>
      </div>
      <div class="navbar"><div class="navbar-inner"><button class="primary start-btn" onclick="App.selectExercise(0)">Rozpocznij trening ›</button></div></div>`, dir);
  }

  function setsWord(n) { const v = parseInt(String(n), 10); return v === 1 ? "seria" : "serie"; }
  function selectExercise(idx) { haptic(HAPTIC.tap); state.exIdx = idx; state.screen = "workout"; requestWake(); renderWorkout("fwd"); }

  function renderWorkout(dir) {
    const w = getWorkout(state.workoutId);
    if (!w) return renderHome("back");
    const total = w.exercises.length;
    const idx = state.exIdx;
    const ex = w.exercises[idx];
    const progress = w.exercises.map((_, i) => `<span class="${i < idx ? "done" : i === idx ? "cur" : ""}"></span>`).join("");
    let tags = "";
    if (ex.opt) tags += `<span class="tag opt">Opcjonalne</span>`;
    if (ex.group) tags += `<span class="tag grp">Seria łączona ${ex.group}</span>`;
    if (ex.finisher) tags += `<span class="tag fin">Wykończenie</span>`;
    const sets = resolve(ex.sets, state.phase);
    const reps = resolve(ex.reps, state.phase);
    const stats = ex.timed ? `
      <div class="stat"><div class="k">Serie / rundy</div><div class="v">${sets}</div></div>
      <div class="stat"><div class="k">Praca</div><div class="v">${reps}</div></div>
      <div class="stat full"><div class="k">Tempo obwodu</div><div class="v sm">30 s praca / 15 s przerwa</div></div>
    ` : `
      <div class="stat"><div class="k">Serie</div><div class="v">${sets}</div></div>
      <div class="stat"><div class="k">Powtórzenia</div><div class="v">${reps}</div></div>
      <div class="stat"><div class="k">Tempo</div><div class="v">${ex.tempo || "—"}</div></div>
      <div class="stat"><div class="k">RIR</div><div class="v ${String(ex.rir||"").length>4?"sm":""}">${ex.rir || "—"}</div></div>
      <div class="stat full"><div class="k">Przerwa</div><div class="v sm">${ex.rest || "—"}</div></div>`;
    const last = Store.lastFor(ex.key);
    let lastHtml = "";
    if (last && last.sets && last.sets.length) {
      const summary = last.sets.map((s) => `${s.w != null && s.w !== "" ? s.w + " kg" : "—"}${s.r ? " × " + s.r : ""}`).join("  ·  ");
      lastHtml = `<div class="last-box"><div class="k">Ostatnio (${fmtDate(last.created_at)})</div><div class="v">${summary}</div></div>`;
    } else if (!ex.timed) {
      lastHtml = `<div class="last-box" style="opacity:.6"><div class="k">Ostatnio</div><div class="v">Brak zapisu — to Twój pierwszy raz 💪</div></div>`;
    }
    const loggerHtml = ex.timed ? `<div class="circuit-note">To ćwiczenie obwodowe — wykonaj ${reps} pracy, 15 s przerwy, ${sets} rund. Brak zapisu ciężaru.</div>` : buildLogger(ex);
    let prehabHtml = "";
    if (idx === 0 && w.prehab && w.prehab.length) {
      prehabHtml = `<div class="prehab"><h3>Przed treningiem (po rozgrzewce)</h3>${w.prehab.map((p) => `<div class="pi"><span>${p.link ? `<a href="${p.link}" target="_blank" rel="noopener">${p.name}</a>` : p.name}</span><span class="pr">${p.sets}×${p.reps}</span></div>`).join("")}</div>`;
    }
    const linkHtml = ex.link ? `<a class="ex-link" href="${ex.link}" target="_blank" rel="noopener">▶ Zobacz technikę</a>` : "";
    const noteHtml = ex.note ? `<div class="ex-note">${ex.note}</div>` : "";
    paint(`<div class="topbar"><button class="iconbtn" onclick="App.goOverview()">‹</button><h1>${w.name} · ${PHASES.find(p=>p.id===state.phase).short}</h1><button class="iconbtn" onclick="App.openHistory('${ex.key}','${escapeAttr(ex.name)}')">⏱</button></div>
      <div class="content">
        <div class="progress">${progress}</div>
        ${prehabHtml}
        <div class="ex-step">Ćwiczenie ${idx + 1} z ${total} ${tags}</div>
        <div class="ex-name">${ex.name}</div>
        ${noteHtml}${linkHtml}
        <div class="stats">${stats}</div>
        ${lastHtml}${loggerHtml}
      </div>
      <div class="navbar"><div class="navbar-inner">
        <button onclick="App.prev()" ${idx === 0 ? "disabled" : ""}>‹ Wstecz</button>
        <button class="rest" onclick="App.startRestFromCurrent()">⏱ ${parseRest(ex.rest) ? parseRest(ex.rest)+"s" : "Przerwa"}</button>
        ${idx === total - 1 ? `<button class="primary" onclick="App.goHome()">Zakończ ✓</button>` : `<button class="primary" onclick="App.next()">Dalej ›</button>`}
      </div></div>`, dir);
    restoreDraft(ex);
  }

  function buildLogger(ex) {
    const sets = resolve(ex.sets, state.phase);
    let n = parseInt(String(sets), 10);
    if (isNaN(n) || n < 1) n = 1;
    if (n > 8) n = 8;
    const draft = state.draft[ex.key];
    const last = Store.lastFor(ex.key);
    const rows = [];
    const count = draft ? draft.length : n;
    for (let i = 0; i < count; i++) { const ph = last && last.sets && last.sets[i] ? last.sets[i] : null; rows.push(setRow(i, ph)); }
    return `<div class="logger-title">Zapisz serie</div>
      <div id="setrows">${rows.join("")}</div>
      <button class="addset" onclick="App.addSet('${ex.key}')">+ Dodaj serię</button>
      <button id="savebtn" class="addset" style="background:var(--good);border:none;color:#fff;margin-top:10px" onclick="App.saveCurrent()">Zapisz ćwiczenie</button>
      <div class="saved-flash" id="flash"></div>`;
  }

  function setRow(i, placeholder) {
    const pw = placeholder && placeholder.w != null ? placeholder.w : "";
    const pr = placeholder && placeholder.r != null ? placeholder.r : "";
    return `<div class="setrow" data-i="${i}">
        <div class="sn">${i + 1}</div>
        <div class="unit" data-u="kg"><input inputmode="decimal" class="in-w" placeholder="${pw !== "" ? pw : "—"}" /></div>
        <div class="unit" data-u="powt"><input inputmode="numeric" class="in-r" placeholder="${pr !== "" ? pr : "—"}" /></div>
        <button class="del" onclick="App.delSet(this)">✕</button></div>`;
  }

  function collectSets() {
    const rows = document.querySelectorAll("#setrows .setrow");
    const out = [];
    rows.forEach((r) => { const w = r.querySelector(".in-w").value.trim().replace(",", "."); const reps = r.querySelector(".in-r").value.trim(); out.push({ w: w === "" ? null : Number(w), r: reps === "" ? null : Number(reps) }); });
    return out;
  }

  function saveDraft(ex) {
    if (!ex || ex.timed) return;
    const rows = document.querySelectorAll("#setrows .setrow");
    if (!rows.length) return;
    const arr = [];
    rows.forEach((r) => { arr.push({ w: r.querySelector(".in-w").value, r: r.querySelector(".in-r").value }); });
    state.draft[ex.key] = arr;
  }

  function restoreDraft(ex) {
    const d = state.draft[ex.key];
    if (!d) return;
    const rows = document.querySelectorAll("#setrows .setrow");
    d.forEach((vals, i) => { if (rows[i]) { rows[i].querySelector(".in-w").value = vals.w || ""; rows[i].querySelector(".in-r").value = vals.r || ""; } });
  }

  function addSet(key) { haptic(HAPTIC.tap); saveDraftCurrent(); const cont = $("setrows"); const i = cont.children.length; cont.insertAdjacentHTML("beforeend", setRow(i, null)); }
  function delSet(btn) { const row = btn.closest(".setrow"); row.remove(); renumber(); saveDraftCurrent(); }
  function renumber() { document.querySelectorAll("#setrows .setrow").forEach((r, i) => { r.querySelector(".sn").textContent = i + 1; r.dataset.i = i; }); }
  function curEx() { const w = getWorkout(state.workoutId); return w ? w.exercises[state.exIdx] : null; }
  function saveDraftCurrent() { saveDraft(curEx()); }

  async function saveCurrent() {
    const ex = curEx();
    if (!ex) return;
    const sets = collectSets().filter((s) => s.w != null || s.r != null);
    const flash = $("flash");
    if (!sets.length) { haptic(HAPTIC.err); if (flash) { flash.style.color = "var(--danger)"; flash.textContent = "Wpisz przynajmniej jedną serię"; } return; }
    const btn = $("savebtn");
    if (btn) { btn.textContent = "Zapisywanie…"; btn.disabled = true; }
    try {
      await Store.saveLog({ exercise_key: ex.key, exercise_name: ex.name, workout_id: state.workoutId, phase: state.phase, log_date: new Date().toISOString().slice(0, 10), sets });
      delete state.draft[ex.key];
      haptic(HAPTIC.ok);
      if (flash) { flash.style.color = "var(--good)"; flash.textContent = "✓ Zapisano"; }
      if (btn) { btn.textContent = "Zapisz ćwiczenie"; btn.disabled = false; }
      const r = parseRest(ex.rest);
      if (r) startRest(r);
    } catch (e) {
      haptic(HAPTIC.err);
      if (flash) { flash.style.color = "var(--danger)"; flash.textContent = "Błąd zapisu: " + e.message; }
      if (btn) { btn.textContent = "Zapisz ćwiczenie"; btn.disabled = false; }
    }
  }

  function next() { saveDraftCurrent(); const w = getWorkout(state.workoutId); if (state.exIdx < w.exercises.length - 1) { haptic(HAPTIC.nav); state.exIdx++; renderWorkout("fwd"); } }
  function prev() { saveDraftCurrent(); if (state.exIdx > 0) { haptic(HAPTIC.nav); state.exIdx--; renderWorkout("back"); } }
  function goOverview() { saveDraftCurrent(); renderOverview("back"); }
  function goHome() { saveDraftCurrent(); renderHome("back"); }

  let timer = { id: null, left: 0, total: 0 };
  const RING_LEN = 2 * Math.PI * 80;
  function parseRest(rest) { if (!rest) return 0; const m = String(rest).match(/(\d+)/); return m ? parseInt(m[1], 10) : 0; }
  function startRestFromCurrent() { const ex = curEx(); const s = parseRest(ex && ex.rest) || 90; startRest(s); }
  function startRest(seconds) { haptic(HAPTIC.start); timer.total = seconds; timer.left = seconds; $("overlay").classList.add("show"); updateRing(); clearInterval(timer.id); timer.id = setInterval(tick, 1000); }
  function tick() { timer.left--; if (timer.left <= 0) { updateRing(); beep(); timerStop(); return; } updateRing(); }
  function updateRing() { $("ringnum").textContent = Math.max(0, timer.left); const frac = timer.total ? timer.left / timer.total : 0; $("ring").setAttribute("stroke-dashoffset", String(RING_LEN * (1 - frac))); }
  function timerAdd(d) { timer.left = Math.max(1, timer.left + d); timer.total = Math.max(timer.total, timer.left); updateRing(); }
  function timerStop() { clearInterval(timer.id); timer.id = null; $("overlay").classList.remove("show"); }
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18, 0.36].forEach((t) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16);
      });
      haptic([200, 100, 200]);
    } catch (e) {}
  }

  async function openHistory(key, name) {
    const all = await Store.allLogs();
    const rows = all.filter((l) => l.exercise_key === key);
    $("sheet-title").textContent = name;
    if (!rows.length) { $("sheet-body").innerHTML = `<div class="empty">Brak historii dla tego ćwiczenia.</div>`; }
    else {
      $("sheet-body").innerHTML = rows.map((l) => {
        const s = (l.sets || []).map((x) => `${x.w != null && x.w !== "" ? x.w + "kg" : "—"}${x.r ? "×" + x.r : ""}`).join("  ·  ");
        return `<div class="hrow"><div class="hd">${new Date(l.created_at).toLocaleDateString("pl-PL", { weekday:"short", day:"numeric", month:"long" })}</div><div class="hs">${s}</div></div>`;
      }).join("");
    }
    $("sheet").classList.add("show");
  }
  function closeHistory() { $("sheet").classList.remove("show"); }

  async function requestWake() { try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {} }
  function releaseWake() { try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {} }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.screen === "workout") requestWake(); });
  function escapeAttr(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, "&quot;"); }

  return { boot, tryUnlock, lockApp, init, setPhase, openWorkout, selectExercise, goOverview, next, prev, goHome, addSet, delSet, saveCurrent, startRestFromCurrent, timerAdd, timerStop, openHistory, closeHistory };
})();

window.addEventListener("DOMContentLoaded", () => {
  App.boot();
  if ("serviceWorker" in navigator) { navigator.serviceWorker.register("sw.js").catch(() => {}); }
});
