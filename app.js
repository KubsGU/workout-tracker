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

  let state = { screen: "home", phase: "w12", workoutId: null, unitIdx: 0, draft: {}, unlocked: false };
  let wakeLock = null;

  const resolve = (val, phase) =>
    (val && typeof val === "object" && ("w12" in val || "w34" in val)) ? val[phase] : val;
  const getWorkout = (id) => WORKOUTS.find((w) => w.id === id);
  function fmtDate(iso) { const d = new Date(iso); return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" }); }
  function exByKey(key) { const w = getWorkout(state.workoutId); return w ? w.exercises.find((e) => e.key === key) : null; }
  function hasDrop(ex) { return !!(ex && ex.note && /dropset/i.test(ex.note)); }

  // Grupowanie ćwiczeń w „jednostki": pojedyncze lub serie łączone (kolejne z group A/B…)
  function buildUnits(w) {
    const units = []; let i = 0;
    while (i < w.exercises.length) {
      if (w.exercises[i].group) {
        const items = [];
        while (i < w.exercises.length && w.exercises[i].group) { items.push(w.exercises[i]); i++; }
        units.push({ superset: items.length > 1, items });
      } else { units.push({ superset: false, items: [w.exercises[i]] }); i++; }
    }
    return units;
  }
  function currentUnit() { const w = getWorkout(state.workoutId); if (!w) return null; return buildUnits(w)[state.unitIdx] || null; }

  // ---------------- HISTORIA (cofanie = powrót, nie wyjście) ----------------
  function histPush(s) { try { history.pushState({ wt: s }, ""); } catch (e) {} }
  function histReplace(s) { try { history.replaceState({ wt: s }, ""); } catch (e) {} }
  window.addEventListener("popstate", (e) => {
    if (!state.unlocked) return;
    saveDraftCurrent();
    const s = (e.state && e.state.wt) || "home";
    if (s === "workout" && getWorkout(state.workoutId)) renderWorkout("back");
    else if (s === "overview" && getWorkout(state.workoutId)) renderOverview("back");
    else renderHome("back");
  });

  // ---------------- HAPTYKA ----------------
  const HAPTIC = { tap: 8, nav: 6, ok: [14, 45, 22], err: 70, start: 12 };
  function haptic(p) { try { if (window.navigator && navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

  // ---------------- KRYPTOGRAFIA (AES-GCM + PBKDF2) ----------------
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
    if (pw) { try { await applyUnlock(pw); return; } catch (e) {} }
    renderLock();
  }
  function renderLock(msg) {
    appEl().innerHTML = `
      <div class="lock"><div class="lock-card">
        <div class="lock-logo">🏋️</div>
        <h1 class="lock-title">Mój Trening</h1>
        <p class="lock-sub">Wpisz hasło, aby odblokować</p>
        <input id="pw" class="lock-input" type="password" autocomplete="current-password" placeholder="Hasło" onkeydown="if(event.key==='Enter')App.tryUnlock()" />
        <label class="lock-remember"><input id="rem" type="checkbox" /> Zapamiętaj na tym urządzeniu</label>
        <button class="lock-btn" onclick="App.tryUnlock()">Odblokuj</button>
        <div class="lock-msg" id="lockmsg">${msg || ""}</div>
      </div></div>`;
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
    const data = await decryptJSON(blob, pw);
    window.PHASES = data.phases; window.WORKOUTS = data.workouts; window.WEEK_SCHEDULE = data.week || [];
    window.SUPABASE_URL = data.supabaseUrl || ""; window.SUPABASE_ANON_KEY = data.supabaseKey || "";
    state.unlocked = true;
    await init();
  }
  function lockApp() { sessionStorage.removeItem("wt_pw"); localStorage.removeItem("wt_pw"); location.reload(); }

  // ---------------- INIT ----------------
  async function init() {
    try { await Store.init(); } catch (e) { console.error(e); }
    const savedPhase = localStorage.getItem("wt_phase");
    if (savedPhase) state.phase = savedPhase;
    renderHome();
    histReplace("home");
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
      </div>`, dir);
  }
  function lastWorkoutDate(workoutId) {
    let latest = null; const wk = getWorkout(workoutId); if (!wk) return null;
    for (const ex of wk.exercises) { const l = Store.lastFor(ex.key); if (l && (!latest || l.created_at > latest)) latest = l.created_at; }
    return latest;
  }
  function setPhase(p) {
    state.phase = p; localStorage.setItem("wt_phase", p);
    if (state.screen === "home") renderHome("none");
    else if (state.screen === "overview") renderOverview("none");
    else renderWorkout("none");
  }
  function openWorkout(id) { haptic(HAPTIC.tap); state.workoutId = id; state.draft = {}; histPush("overview"); renderOverview("fwd"); }
  function isDoneToday(key) { const l = Store.lastFor(key); return l && l.log_date === new Date().toISOString().slice(0, 10); }

  function exChips(ex) {
    const sets = resolve(ex.sets, state.phase), reps = resolve(ex.reps, state.phase);
    if (ex.timed) return `<span class="chip">${sets} rund</span><span class="chip">${reps}</span>`;
    return `<span class="chip">${sets} ${setsWord(sets)}</span><span class="chip">${reps} powt.</span>${ex.tempo && ex.tempo !== "—" ? `<span class="chip">tempo ${ex.tempo}</span>` : ""}${ex.rest && ex.rest !== "—" ? `<span class="chip">${ex.rest}</span>` : ""}`;
  }

  function renderOverview(dir) {
    const w = getWorkout(state.workoutId);
    if (!w) return renderHome("back");
    state.screen = "overview"; releaseWake();
    const phaseShort = PHASES.find((p) => p.id === state.phase).short;
    const units = buildUnits(w);
    const items = units.map((u, i) => {
      const done = u.items.every((ex) => isDoneToday(ex.key));
      const num = done ? "✓" : i + 1;
      if (u.superset) {
        const lines = u.items.map((ex) => {
          const last = Store.lastFor(ex.key);
          const lt = (last && last.sets && last.sets.length) ? `<span class="ss-last">ost. ${fmtSets(last.sets, true)}</span>` : "";
          return `<div class="ss-line"><b>${ex.group}</b><span class="ss-nm">${ex.name}</span>${lt}</div>`;
        }).join("");
        return `<button class="ov-item ${done ? "done" : ""}" onclick="App.selectUnit(${i})">
            <div class="ov-num">${num}</div>
            <div class="ov-mid"><div class="ov-tags"><span class="tag grp">Seria łączona</span></div>${lines}</div>
            <div class="ov-chev">›</div></button>`;
      }
      const ex = u.items[0];
      let tags = "";
      if (ex.opt) tags += `<span class="tag opt">Opcjonalne</span>`;
      if (ex.finisher) tags += `<span class="tag fin">Wykończenie</span>`;
      if (hasDrop(ex)) tags += `<span class="tag drop">Dropset</span>`;
      const last = Store.lastFor(ex.key);
      const lastTxt = (last && last.sets && last.sets.length && !ex.timed) ? `<div class="ov-last">Ostatnio: ${fmtSets(last.sets, true)}</div>` : "";
      return `<button class="ov-item ${done ? "done" : ""}" onclick="App.selectUnit(${i})">
          <div class="ov-num">${num}</div>
          <div class="ov-mid"><div class="ov-name">${ex.name}</div><div class="ov-sub">${exChips(ex)}</div>${tags ? `<div class="ov-tags">${tags}</div>` : ""}${lastTxt}</div>
          <div class="ov-chev">›</div></button>`;
    }).join("");
    const prehabTxt = (w.prehab && w.prehab.length) ? `<div class="meta">Przed treningiem: ${w.prehab.map((p) => p.name.split(" (")[0]).join(", ")}</div>` : "";
    paint(`<div class="topbar"><button class="iconbtn" onclick="App.back()">‹</button><h1>${w.name}</h1></div>
      <div class="content">
        <div class="ov-head"><span class="bar" style="background:${w.color}"></span><div class="t">${w.name}</div><div class="f">${w.focus}</div><div class="meta">Faza: Tydzień ${phaseShort} · ${units.length} pozycji</div>${prehabTxt}</div>
        <div class="section-label">Plan — stuknij, aby zacząć</div>
        <div class="ov-list stagger">${items}</div>
      </div>
      <div class="navbar"><div class="navbar-inner"><button class="primary start-btn" onclick="App.selectUnit(0)">Rozpocznij trening ›</button></div></div>`, dir);
  }

  function setsWord(n) { const v = parseInt(String(n), 10); return v === 1 ? "seria" : "serie"; }
  function selectUnit(i) { haptic(HAPTIC.tap); state.unitIdx = i; state.screen = "workout"; requestWake(); histPush("workout"); renderWorkout("fwd"); }

  // Formatowanie zapisanych serii (z dropsetami)
  function fmtSets(sets, compact) {
    const wkg = (v) => (v != null && v !== "" ? v + (compact ? "kg" : " kg") : "—");
    return (sets || []).map((s) => {
      let base = wkg(s.w) + (s.r ? (compact ? "×" : " × ") + s.r : "");
      if (s.drops && s.drops.length) base += " ⤵ " + s.drops.map((d) => wkg(d.w) + (d.r ? (compact ? "×" : " × ") + d.r : "")).join(" ⤵ ");
      return base;
    }).join(compact ? " · " : "  ·  ");
  }

  function exerciseBlock(ex) {
    const sets = resolve(ex.sets, state.phase), reps = resolve(ex.reps, state.phase);
    let tags = "";
    if (ex.opt) tags += `<span class="tag opt">Opcjonalne</span>`;
    if (ex.finisher) tags += `<span class="tag fin">Wykończenie</span>`;
    if (hasDrop(ex)) tags += `<span class="tag drop">Dropset</span>`;
    const stats = ex.timed ? `
      <div class="stat"><div class="k">Serie / rundy</div><div class="v">${sets}</div></div>
      <div class="stat"><div class="k">Praca</div><div class="v">${reps}</div></div>
      <div class="stat full"><div class="k">Tempo obwodu</div><div class="v sm">30 s praca / 15 s przerwa</div></div>` : `
      <div class="stat"><div class="k">Serie</div><div class="v">${sets}</div></div>
      <div class="stat"><div class="k">Powtórzenia</div><div class="v">${reps}</div></div>
      <div class="stat"><div class="k">Tempo</div><div class="v">${ex.tempo || "—"}</div></div>
      <div class="stat"><div class="k">RIR</div><div class="v ${String(ex.rir || "").length > 4 ? "sm" : ""}">${ex.rir || "—"}</div></div>
      <div class="stat full"><div class="k">Przerwa</div><div class="v sm">${ex.rest || "—"}</div></div>`;
    const last = Store.lastFor(ex.key);
    let lastHtml = "";
    if (last && last.sets && last.sets.length) lastHtml = `<div class="last-box"><div class="k">Ostatnio (${fmtDate(last.created_at)})</div><div class="v">${fmtSets(last.sets)}</div></div>`;
    else if (!ex.timed) lastHtml = `<div class="last-box" style="opacity:.6"><div class="k">Ostatnio</div><div class="v">Brak zapisu — to Twój pierwszy raz 💪</div></div>`;
    const linkHtml = ex.link ? `<a class="ex-link" href="${ex.link}" target="_blank" rel="noopener">▶ Technika</a>` : "";
    const noteHtml = ex.note ? `<div class="ex-note">${ex.note}</div>` : "";
    const grpBadge = ex.group ? `<span class="tag grp">${ex.group}</span> ` : "";
    const logger = ex.timed
      ? `<div class="circuit-note">Obwód: ${reps} pracy, 15 s przerwy, ${sets} rund. Bez zapisu ciężaru.</div>`
      : buildLogger(ex);
    return `<div class="exblock" id="block-${ex.key}">
        <div class="exhead"><div class="nm"><div class="ex-name">${grpBadge}${ex.name}</div>${tags ? `<div class="ex-step" style="margin-top:8px">${tags}</div>` : ""}</div>
          <button class="iconbtn sm" onclick="App.openHistory('${ex.key}','${escapeAttr(ex.name)}')" title="Historia">⏱</button></div>
        ${noteHtml}${linkHtml}
        <div class="stats">${stats}</div>
        ${lastHtml}${logger}</div>`;
  }

  function renderWorkout(dir) {
    const w = getWorkout(state.workoutId);
    if (!w) return renderHome("back");
    const units = buildUnits(w); const total = units.length; const idx = state.unitIdx;
    const unit = units[idx]; if (!unit) { state.unitIdx = 0; return renderOverview("back"); }
    const progress = units.map((_, i) => `<span class="${i < idx ? "done" : i === idx ? "cur" : ""}"></span>`).join("");
    let prehabHtml = "";
    if (idx === 0 && w.prehab && w.prehab.length) {
      prehabHtml = `<div class="prehab"><h3>Przed treningiem (po rozgrzewce)</h3>${w.prehab.map((p) => `<div class="pi"><span>${p.link ? `<a href="${p.link}" target="_blank" rel="noopener">${p.name}</a>` : p.name}</span><span class="pr">${p.sets}×${p.reps}</span></div>`).join("")}</div>`;
    }
    const banner = unit.superset ? `<div class="ss-banner">🔗 <b>Seria łączona</b> — wykonaj ćwiczenia po kolei (A → B). To jedna seria; odpocznij dopiero po ostatnim.</div>` : "";
    const blocks = unit.items.map(exerciseBlock).join("");
    const restEx = unit.items[unit.items.length - 1];
    const restSec = parseRest(restEx.rest);
    paint(`<div class="topbar"><button class="iconbtn" onclick="App.back()">‹</button><h1>${w.name} · ${PHASES.find((p) => p.id === state.phase).short}</h1></div>
      <div class="content">
        <div class="progress">${progress}</div>
        ${prehabHtml}
        <div class="ex-step">Pozycja ${idx + 1} z ${total}${unit.superset ? ` <span class="tag grp">Seria łączona</span>` : ""}</div>
        ${banner}
        ${blocks}
      </div>
      <div class="navbar"><div class="navbar-inner">
        <button onclick="App.prev()" ${idx === 0 ? "disabled" : ""}>‹ Wstecz</button>
        <button class="rest" onclick="App.startRestFromCurrent()">⏱ ${restSec ? restSec + "s" : "Przerwa"}</button>
        ${idx === total - 1 ? `<button class="primary" onclick="App.finishWorkout()">Zakończ ✓</button>` : `<button class="primary" onclick="App.next()">Dalej ›</button>`}
      </div></div>`, dir);
  }

  // ---------------- LOGGER (z dropsetami) ----------------
  function initialSets(ex) {
    if (state.draft[ex.key]) return state.draft[ex.key];
    let n = parseInt(String(resolve(ex.sets, state.phase)), 10);
    if (isNaN(n) || n < 1) n = 1; if (n > 8) n = 8;
    const arr = []; for (let i = 0; i < n; i++) arr.push({ w: "", r: "", drops: [] });
    return arr;
  }
  function dropRow(d) {
    return `<div class="droprow"><span class="darr">⤵</span>
      <input class="d-w" inputmode="decimal" value="${d && d.w != null ? d.w : ""}" placeholder="kg" />
      <input class="d-r" inputmode="numeric" value="${d && d.r != null ? d.r : ""}" placeholder="powt" />
      <button class="del" onclick="App.delDrop(this)">✕</button></div>`;
  }
  function setBlock(key, i, vals, drop, ph) {
    const drops = (vals.drops || []).map(dropRow).join("");
    return `<div class="setblock" data-i="${i}">
        <div class="setrow">
          <div class="sn">${i + 1}</div>
          <div class="unit" data-u="kg"><input inputmode="decimal" class="in-w" value="${vals.w != null ? vals.w : ""}" placeholder="${ph && ph.w != null && ph.w !== "" ? ph.w : "—"}" /></div>
          <div class="unit" data-u="powt"><input inputmode="numeric" class="in-r" value="${vals.r != null ? vals.r : ""}" placeholder="${ph && ph.r != null && ph.r !== "" ? ph.r : "—"}" /></div>
          <button class="del" onclick="App.delSet(this)">✕</button>
        </div>
        <div class="drop-list">${drops}</div>
        ${drop ? `<button class="dropbtn" onclick="App.addDrop('${key}',this)">+ seria zrzutowa (dropset)</button>` : ""}
      </div>`;
  }
  function buildLogger(ex) {
    const drop = hasDrop(ex);
    const last = Store.lastFor(ex.key);
    const vals = initialSets(ex);
    const rows = vals.map((v, i) => setBlock(ex.key, i, v, drop, last && last.sets ? last.sets[i] : null)).join("");
    return `<div class="logger-title">Zapisz serie${drop ? " · z dropsetami" : ""}</div>
      <div class="setrows" id="rows-${ex.key}">${rows}</div>
      <button class="addset" onclick="App.addSet('${ex.key}')">+ Dodaj serię</button>
      <button class="addset save" onclick="App.saveExercise('${ex.key}')">Zapisz „${escapeAttr(shortName(ex.name))}"</button>
      <div class="saved-flash" id="flash-${ex.key}"></div>`;
  }
  function shortName(n) { return n.length > 22 ? n.slice(0, 20) + "…" : n; }

  function addSet(key) {
    haptic(HAPTIC.tap); saveDraftCurrent();
    const cont = $("rows-" + key); if (!cont) return;
    const i = cont.querySelectorAll(".setblock").length;
    cont.insertAdjacentHTML("beforeend", setBlock(key, i, { w: "", r: "", drops: [] }, hasDrop(exByKey(key)), null));
  }
  function delSet(btn) { const cont = btn.closest(".setrows"); btn.closest(".setblock").remove(); renumber(cont); saveDraftCurrent(); }
  function renumber(cont) { if (!cont) return; cont.querySelectorAll(".setblock").forEach((b, i) => { b.dataset.i = i; const sn = b.querySelector(".sn"); if (sn) sn.textContent = i + 1; }); }
  function addDrop(key, btn) { haptic(HAPTIC.tap); const list = btn.parentElement.querySelector(".drop-list"); list.insertAdjacentHTML("beforeend", dropRow(null)); }
  function delDrop(btn) { btn.closest(".droprow").remove(); }

  function readRaw(key) {
    const cont = $("rows-" + key); if (!cont) return null;
    const out = [];
    cont.querySelectorAll(".setblock").forEach((b) => {
      const w = b.querySelector(".in-w").value, r = b.querySelector(".in-r").value;
      const drops = [];
      b.querySelectorAll(".droprow").forEach((d) => drops.push({ w: d.querySelector(".d-w").value, r: d.querySelector(".d-r").value }));
      out.push({ w, r, drops });
    });
    return out;
  }
  function collectSets(key) {
    const raw = readRaw(key) || [];
    const num = (v) => { v = String(v).trim().replace(",", "."); return v === "" ? null : Number(v); };
    return raw.map((s) => {
      const drops = (s.drops || []).map((d) => ({ w: num(d.w), r: num(d.r) })).filter((d) => d.w != null || d.r != null);
      const o = { w: num(s.w), r: num(s.r) };
      if (drops.length) o.drops = drops;
      return o;
    });
  }
  function saveDraftCurrent() {
    if (state.screen !== "workout") return;
    const u = currentUnit(); if (!u) return;
    u.items.forEach((ex) => { if (!ex.timed) { const raw = readRaw(ex.key); if (raw) state.draft[ex.key] = raw; } });
  }

  async function saveExercise(key) {
    const ex = exByKey(key); if (!ex) return;
    const sets = collectSets(key).filter((s) => s.w != null || s.r != null || (s.drops && s.drops.length));
    const flash = $("flash-" + key);
    if (!sets.length) { haptic(HAPTIC.err); if (flash) { flash.style.color = "var(--danger)"; flash.textContent = "Wpisz przynajmniej jedną serię"; } return; }
    const btn = appEl().querySelector(`#block-${key} .save`);
    if (btn) { btn.dataset.t = btn.textContent; btn.textContent = "Zapisywanie…"; btn.disabled = true; }
    try {
      await Store.saveLog({ exercise_key: ex.key, exercise_name: ex.name, workout_id: state.workoutId, phase: state.phase, log_date: new Date().toISOString().slice(0, 10), sets });
      delete state.draft[ex.key];
      haptic(HAPTIC.ok);
      if (flash) { flash.style.color = "var(--good)"; flash.textContent = "✓ Zapisano"; }
      if (btn) { btn.textContent = btn.dataset.t; btn.disabled = false; }
      const r = parseRest(ex.rest); if (r) startRest(r);
    } catch (e) {
      haptic(HAPTIC.err);
      if (flash) { flash.style.color = "var(--danger)"; flash.textContent = "Błąd zapisu: " + e.message; }
      if (btn) { btn.textContent = btn.dataset.t; btn.disabled = false; }
    }
  }

  function next() { saveDraftCurrent(); const total = buildUnits(getWorkout(state.workoutId)).length; if (state.unitIdx < total - 1) { haptic(HAPTIC.nav); state.unitIdx++; histReplace("workout"); renderWorkout("fwd"); } }
  function prev() { saveDraftCurrent(); if (state.unitIdx > 0) { haptic(HAPTIC.nav); state.unitIdx--; histReplace("workout"); renderWorkout("back"); } }
  function back() { saveDraftCurrent(); try { history.back(); } catch (e) { renderHome("back"); } }
  function finishWorkout() { saveDraftCurrent(); try { history.go(-2); } catch (e) { renderHome("back"); } }

  // ---------------- LICZNIK PRZERWY (działa też w tle) ----------------
  // Bazuje na docelowym czasie (timestamp), więc nie „zamarza" gdy aplikacja
  // jest zminimalizowana — po powrocie odlicza poprawnie, a po zakończeniu
  // pokazuje powiadomienie + wibrację.
  let timer = { id: null, end: 0, total: 0, running: false };
  const RING_LEN = 2 * Math.PI * 80;
  function parseRest(rest) { if (!rest) return 0; const m = String(rest).match(/(\d+)/); return m ? parseInt(m[1], 10) : 0; }
  function startRestFromCurrent() { const u = currentUnit(); const ex = u ? u.items[u.items.length - 1] : null; startRest(parseRest(ex && ex.rest) || 90); }
  function remaining() { return Math.max(0, Math.round((timer.end - Date.now()) / 1000)); }
  function startRest(seconds) {
    if (!seconds) return;
    haptic(HAPTIC.start); ensureNotifyPermission();
    timer.total = seconds; timer.end = Date.now() + seconds * 1000; timer.running = true;
    $("overlay").classList.add("show");
    updateRing();
    clearInterval(timer.id);
    timer.id = setInterval(tickTimer, 250);
  }
  function tickTimer() { const left = remaining(); drawRing(left); if (left <= 0) finishRest(); }
  function drawRing(left) { $("ringnum").textContent = left; const frac = timer.total ? left / timer.total : 0; $("ring").setAttribute("stroke-dashoffset", String(RING_LEN * (1 - frac))); }
  function updateRing() { drawRing(remaining()); }
  function timerAdd(d) { if (!timer.running) return; timer.end += d * 1000; const left = remaining(); timer.total = Math.max(timer.total, left); updateRing(); }
  function finishRest() {
    if (!timer.running) return;
    timer.running = false; clearInterval(timer.id); timer.id = null;
    $("overlay").classList.remove("show");
    beep(); haptic([220, 120, 220]);
    notify("⏱ Przerwa zakończona", "Czas na kolejną serię 💪");
  }
  function timerStop() { timer.running = false; clearInterval(timer.id); timer.id = null; $("overlay").classList.remove("show"); }
  // Po powrocie do aplikacji: dolicz czas, który minął w tle.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (state.screen === "workout") requestWake();
    if (timer.running) { if (remaining() <= 0) finishRest(); else updateRing(); }
  });
  window.addEventListener("focus", () => { if (timer.running) { if (remaining() <= 0) finishRest(); else updateRing(); } });

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
    } catch (e) {}
  }
  function ensureNotifyPermission() { try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (e) {} }
  function notify(title, body) {
    try {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      const opts = { body, tag: "rest-timer", renotify: true, vibrate: [220, 120, 220], icon: "icon-192.png", badge: "icon-192.png" };
      if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, opts)).catch(() => { try { new Notification(title, opts); } catch (e) {} });
      else new Notification(title, opts);
    } catch (e) {}
  }

  async function openHistory(key, name) {
    const all = await Store.allLogs();
    const rows = all.filter((l) => l.exercise_key === key);
    $("sheet-title").textContent = name;
    $("sheet-body").innerHTML = rows.length
      ? rows.map((l) => `<div class="hrow"><div class="hd">${new Date(l.created_at).toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "long" })}</div><div class="hs">${fmtSets(l.sets)}</div></div>`).join("")
      : `<div class="empty">Brak historii dla tego ćwiczenia.</div>`;
    $("sheet").classList.add("show");
  }
  function closeHistory() { $("sheet").classList.remove("show"); }

  async function requestWake() { try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {} }
  function releaseWake() { try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {} }
  function escapeAttr(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, "&quot;"); }

  return { boot, tryUnlock, lockApp, init, setPhase, openWorkout, selectUnit, back, finishWorkout, next, prev,
    addSet, delSet, addDrop, delDrop, saveExercise, startRestFromCurrent, timerAdd, timerStop, openHistory, closeHistory };
})();

window.addEventListener("DOMContentLoaded", () => {
  App.boot();
  registerSWWithAutoUpdate();
});

function registerSWWithAutoUpdate() {
  if (!("serviceWorker" in navigator)) return;
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !hadController) return;
    reloading = true; location.reload();
  });
  navigator.serviceWorker.register("sw.js").then((reg) => {
    const check = () => { try { reg.update(); } catch (e) {} };
    setInterval(check, 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) { try { nw.postMessage("skipWaiting"); } catch (e) {} } });
    });
  }).catch(() => {});
}
