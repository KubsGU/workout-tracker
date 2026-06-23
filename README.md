# Mój Trening — aplikacja do śledzenia planu

Prosta aplikacja webowa (PWA) skrojona pod Twój plan z PDF. Działa w przeglądarce
i na telefonie (Samsung S25) jako ikona na ekranie głównym.

Podczas treningu: ekran przeglądu z całym planem ćwiczeń, a po stuknięciu —
widok z liczbą serii, powtórzeń, tempem, RIR, przerwą oraz **ostatnio użytym
ciężarem**, z możliwością zapisania nowego. Płynne animacje i wibracje (haptyka).

## 🔒 Prywatność — jak to działa
Strona na GitHub Pages jest publiczna, więc **plan treningowy i klucze Supabase
są zaszyfrowane** (AES-256-GCM, klucz wyprowadzany z hasła przez PBKDF2). W repo
trafia tylko zaszyfrowany plik `data.enc.json`. Przy otwarciu aplikacja pyta o
hasło i odszyfrowuje dane w pamięci. Bez hasła nikt nie zobaczy ani planu, ani
kluczy — choćby znał adres strony. **Hasła nie da się odzyskać.** Siła ochrony
zależy od siły hasła, więc użyj mocnego.

## Pliki
- `index.html`, `app.js`, `store.js` — aplikacja (publiczne, bez sekretów)
- `data.enc.json` — **zaszyfrowany** plan + dane Supabase (generujesz w setupie)
- `encrypt.html` — narzędzie do szyfrowania (uruchamiasz lokalnie)
- `plan.source.js` — jawne źródło planu (NIE wrzucaj na GitHub — jest w `.gitignore`)
- `manifest.webmanifest`, `sw.js`, `icon-*.png` — pliki PWA

---

## Krok 1 — Setup (utwórz `data.enc.json`)
Robisz to **lokalnie na komputerze**, raz (i przy każdej zmianie planu/kluczy):

1. W folderze aplikacji otwórz `encrypt.html` w przeglądarce (dwuklik wystarczy).
2. (Opcjonalnie) wklej **Project URL** i **anon key** z Supabase — patrz Krok 3.
   Zostaw puste, jeśli na razie nie chcesz synchronizacji.
3. Wymyśl **hasło** (min. 8 znaków) i wpisz je dwa razy.
4. Kliknij „Wygeneruj i pobierz" — pobierze się `data.enc.json`.
5. Skopiuj `data.enc.json` do folderu aplikacji (obok `index.html`).

> Plan edytujesz w pliku `plan.source.js`. Po każdej zmianie powtórz setup,
> aby odświeżyć `data.enc.json`.

---

## Krok 2 — Hosting za darmo na GitHub Pages
1. Załóż konto na https://github.com i kliknij **New repository** (np. `trening`, **Public**).
2. **Add file → Upload files** i wrzuć pliki:
   `index.html`, `app.js`, `store.js`, `data.enc.json`, `manifest.webmanifest`,
   `sw.js`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`.
   **NIE wrzucaj** `plan.source.js`, `encrypt.html` ani `plan.pdf` (to Twoje prywatne źródła).
3. **Commit changes**, potem **Settings → Pages**: Branch **main**, folder **/ (root)**, **Save**.
4. Po chwili dostaniesz adres `https://twójlogin.github.io/trening/`.

### Na telefonie (S25)
Otwórz adres w Chrome → menu (⋮) → **Dodaj do ekranu głównego**. Aplikacja
działa jak natywna, również offline. Przy pierwszym uruchomieniu wpisz hasło i
zaznacz „Zapamiętaj na tym urządzeniu", aby nie wpisywać go za każdym razem.
Ikoną 🔒 na ekranie głównym możesz w każdej chwili się wylogować.

---

## Krok 3 — Synchronizacja telefon ↔ przeglądarka (opcjonalnie)
Aby logi były wspólne na obu urządzeniach, użyj darmowego Supabase:

1. https://supabase.com → **New project** (zapamiętaj hasło bazy, region np. Frankfurt).
2. **SQL Editor → New query**, wklej i uruchom:

   ```sql
   create table if not exists workout_logs (
     id bigint generated always as identity primary key,
     created_at timestamptz default now(),
     exercise_key text, exercise_name text, workout_id text,
     phase text, log_date date, sets jsonb
   );
   alter table workout_logs enable row level security;
   create policy "public access" on workout_logs for all using (true) with check (true);
   ```

3. **Project Settings → API**: skopiuj **Project URL** i **anon public** key.
4. Wpisz je w `encrypt.html` (Krok 1) i wygeneruj nowy `data.enc.json`, wgraj na GitHub.

Klucze są teraz zaszyfrowane — nie są widoczne publicznie. Gdy synchronizacja
działa, kropka przy nazwie zrobi się zielona („Synchronizacja wł.").

---

## 🔄 Aktualizacje (automatyczne)
Aplikacja sama pobiera najnowszą wersję — **nie trzeba czyścić pamięci przeglądarki**.
Service worker działa w trybie „network-first": gdy jesteś online, zawsze ładuje
świeże pliki, a pamięć podręczna służy tylko do działania offline. Dodatkowo, gdy
wykryje nową wersję, otwarta aplikacja **przeładuje się sama**.

Przy każdym nowym release wystarczy:
1. Wgrać zmienione pliki na GitHub (np. nowy `app.js` lub `data.enc.json`).
2. (Zalecane) podbić numer wersji w `sw.js` — zmień `trening-v3` na `trening-v4`
   itd. Dzięki temu nawet już otwarte aplikacje na telefonie przeładują się
   automatycznie w ciągu minuty. Bez tego najnowsza wersja i tak pojawi się przy
   kolejnym otwarciu/odświeżeniu — nigdy nie trzeba ręcznie czyścić cache.

---

## Jak używać
1. Wpisz hasło na ekranie blokady.
2. Wybierz fazę (Tydzień 1–2 / 3–4) i trening (1–4 lub Brzuch).
3. Na ekranie przeglądu widzisz cały plan — stuknij dowolne ćwiczenie, by zacząć
   od niego, lub „Rozpocznij trening", by od pierwszego.
4. Wpisz kg i powtórzenia → **Zapisz** (wibracja + auto-licznik przerwy).
   - **Serie łączone (superset)** pokazują się jako jedna pozycja — oba ćwiczenia
     (A i B) na jednym ekranie; odpoczywasz dopiero po ostatnim.
   - **Dropsety**: przy ćwiczeniach z dropsetem pod każdą serią jest przycisk
     „+ seria zrzutowa", którym dopinasz zrzuty ciężaru do danej serii.
5. Ikona ⏱ pokazuje historię ćwiczenia. Zielone „✓" = zrobione dzisiaj.
6. **Licznik przerwy działa też w tle** — gdy zminimalizujesz aplikację, po
   powrocie odlicza poprawnie, a po zakończeniu pokazuje powiadomienie i wibruje
   (zezwól na powiadomienia przy pierwszej przerwie).

Plan obejmuje tygodnie 1–4 z PDF (fazy 1–2 i 3–4 różnią się liczbą serii).
