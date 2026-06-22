// ===== Warstwa danych: Supabase (sync) z fallbackiem na localStorage =====
//
// Eksportuje globalny obiekt `Store` z metodami:
//   Store.init()                         -> Promise, ustawia tryb (cloud/local)
//   Store.mode                           -> "cloud" | "local"
//   Store.allLogs()                      -> Promise<Array logów>
//   Store.lastFor(exerciseKey)           -> ostatni log danego ćwiczenia (lub null)
//   Store.saveLog(log)                   -> Promise, zapisuje nowy log
//   Store.deleteLog(id)                  -> Promise, usuwa log
//
// Log: { id, created_at, exercise_key, exercise_name, workout_id, phase, log_date, sets }
//   sets: [{ w: <kg|null>, r: <powt|null> }, ...]

const Store = (() => {
  const LS_KEY = "wt_logs_v1";
  let mode = "local";
  let sb = null;
  let cache = []; // lokalny cache wszystkich logów (posortowane malejąco po dacie)

  // ---------- localStorage ----------
  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
    catch { return []; }
  }
  function lsWrite(arr) {
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  }

  function sortDesc(arr) {
    return arr.slice().sort((a, b) =>
      (b.created_at || "").localeCompare(a.created_at || ""));
  }

  // ---------- init ----------
  async function init() {
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;
    if (url && key && window.supabase) {
      try {
        sb = window.supabase.createClient(url, key);
        // test + wczytanie
        const { data, error } = await sb
          .from("workout_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(2000);
        if (error) throw error;
        cache = data || [];
        mode = "cloud";
        return;
      } catch (e) {
        console.warn("Supabase niedostępny, tryb lokalny:", e.message);
      }
    }
    mode = "local";
    cache = sortDesc(lsRead());
  }

  async function allLogs() {
    return cache;
  }

  function lastFor(exerciseKey) {
    for (const l of cache) if (l.exercise_key === exerciseKey) return l;
    return null;
  }

  async function saveLog(log) {
    const row = {
      exercise_key: log.exercise_key,
      exercise_name: log.exercise_name,
      workout_id: log.workout_id,
      phase: log.phase,
      log_date: log.log_date,
      sets: log.sets,
    };
    if (mode === "cloud") {
      const { data, error } = await sb
        .from("workout_logs")
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      cache.unshift(data);
      return data;
    } else {
      const saved = {
        ...row,
        id: "loc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        created_at: new Date().toISOString(),
      };
      const arr = lsRead();
      arr.push(saved);
      lsWrite(arr);
      cache.unshift(saved);
      return saved;
    }
  }

  async function deleteLog(id) {
    if (mode === "cloud") {
      const { error } = await sb.from("workout_logs").delete().eq("id", id);
      if (error) throw error;
    } else {
      lsWrite(lsRead().filter((l) => l.id !== id));
    }
    cache = cache.filter((l) => l.id !== id);
  }

  return {
    init,
    get mode() { return mode; },
    allLogs,
    lastFor,
    saveLog,
    deleteLog,
  };
})();
