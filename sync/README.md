# Lernfabrik-Sync: Einzelquelle Lernfortschritt

Standard seit 27.11.2026 (Workflow-Idee 2 der Freitagsroutine, auf Anweisung umgesetzt):

Die Notion-Datenbank **Lernfortschritt Datenbank (Klasse 11)** ist die **führende Quelle**
für alle bewerteten Arbeiten der Nachhilfe. Die DATA-Zeilen des Lernfabrik-Dashboards
(`dashboard.html`) werden daraus **abgeleitet** – ein Pflegeschritt statt zwei,
keine vergessenen Zeilen mehr (wie zuletzt PK3).

## Ablauf nach jeder bewerteten Arbeit

1. **Notion-DB-Zeile anlegen/aktualisieren** (der einzige manuelle Pflegeschritt):
   Titel, Fach, Typ, Punkte, Maximum, Note, Tendenz, Bonus, Bearbeitet am,
   Wertungshinweis, Aktive Baustellen, Gefestigt (neu) – und für das Dashboard:
   - `Dashboard-Typ` (kurzer Typ-Text, z. B. „Probeklausur 4“; leer = wird aus Typ+Titel abgeleitet)
   - `Dashboard-Titel` (kurzer Anzeigetitel; leer = wird aus Titel abgeleitet)
   - `Dashboard-Info` (motivierender Kurz-Satz für die Dashboard-Zeile)
   Unbewertete Arbeiten (z. B. Hausaufgaben ohne Punktebewertung) bekommen **keine**
   Punkte/Maximum und erscheinen dadurch automatisch nicht im Dashboard.
2. **DB-Export in die Session holen** (Notion `query_data_sources`, rows-Modus,
   Sortierung nach „Bearbeitet am“) und als `export.json` speichern.
   Die Exportdatei enthält personenbezogene Daten: **nie in dieses öffentliche Repo legen.**
3. **Ableiten und prüfen**:
   ```bash
   node sync/lernfabrik_sync.js export.json --check src/dashboard.html
   ```
   Zeigt: fehlende, neue und abweichende Zeilen (Punkte/Maximum/Note) im Abgleich.
4. **DATA-Block ersetzen** (nur wenn --check Neues meldet):
   ```bash
   node sync/lernfabrik_sync.js export.json --write src/dashboard.html
   ```
   Das Skript verweigert den Schreibvorgang, wenn die Datei Zeilen enthält,
   die nicht in der Notion-DB liegen (DB ist führende Quelle).
5. **Wie gehabt bauen und deployen** (Passwort nur interaktiv, nie speichern):
   ```bash
   node encrypt.js src/dashboard.html site/dashboard.html
   node verify.js  site/dashboard.html src/dashboard.html
   # Klartext-Spuren-Check außerhalb des __PAY__-Ausdrucks, dann:
   # push_files (alle Dateien in EINEM Commit) -> automatischer Pages-Deploy
   ```

## Feld-Mapping (Notion-DB -> DATA-Zeile)

| DATA-Feld   | Quelle                                                      |
|-------------|-------------------------------------------------------------|
| `date`      | „Bearbeitet am“                                             |
| `s`         | Fach (Schlüssel wie SUBJECTS im dashboard.html)             |
| `type`      | `Dashboard-Typ` (Fallback: aus Typ + Probeklausur-Nummer)   |
| `title`     | `Dashboard-Titel` (Fallback: aus Titel abgeleitet)          |
| `pts`/`max` | „Punkte“/„Maximum“                                          |
| `grade`     | „Note“ (bleibt 1-6-String, Quelle der Wahrheit; die Punkteanzeige 0–15 rechnet dashboard.html selbst) |
| `gnote`     | Note + „ (Tendenz-Kern)“ – Tendenz bis zum ersten „;“          |
| `bonus`     | „Bonus“ (leer = null)                                       |
| `info`      | `Dashboard-Info` (leer = TODO-Marker)                       |

## Bewusst nicht automatisiert

- `BADGES` und `MASTERY` in `dashboard.html` sind kuratierte Inhalte
  (Lernprofil-Logik, Badges wie „Merksatz-Meisterin“) und bleiben manuell gepflegt.
- Die Noten-App (`noten.html`, localStorage `lfNotenV1`) hat ihre eigene Datenbasis
  und ist nicht Teil dieses Syncs.

## Hinweis

`export.json` gehört nur in die laufende Session bzw. einen privaten Speicher
(lokales `vibe_tmp`/Drive), niemals in dieses öffentliche Repo.
