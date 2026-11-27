#!/usr/bin/env node
/**
 * Lernfabrik-Sync: leitet die DATA-Zeilen für dashboard.html (Lernfabrik)
 * aus dem Notion-Export der Datenbank "Lernfortschritt Datenbank (Klasse 11)" ab.
 *
 * Einzelquelle-Prinzip (Standard ab 27.11.2026):
 *   1. Nach jeder bewerteten Arbeit: genau EINE Zeile in der Notion-DB pflegen
 *      (inkl. Dashboard-Typ / Dashboard-Titel / Dashboard-Info).
 *   2. Die Lernfabrik-DATA-Zeile wird ausschließlich hieraus abgeleitet –
 *      nie unabhängig doppelt pflegen.
 *
 * Nutzung:
 *   node sync/lernfabrik_sync.js export.json                 -> DATA-Literal nach stdout
 *   node sync/lernfabrik_sync.js export.json --check pfad    -> Abgleich mit src/dashboard.html (nur lesen)
 *   node sync/lernfabrik_sync.js export.json --write pfad    -> DATA-Block in src/dashboard.html ersetzen
 *
 * export.json = Ergebnis von Notion query_data_sources (rows-Modus),
 * gespeichert als {"results":[...]}. Enthält KEINE Geheimnisse, aber
 * personenbezogene Daten: gehört nicht ins öffentliche Repo, nur lokal/Session.
 *
 * BADGES und MASTERY im dashboard.html bleiben kuratierte Inhalte
 * (Lernprofil-Logik) und werden von diesem Skript NICHT angetastet.
 */
"use strict";
const fs = require("fs");

const FACH_KEYS = {
  physik: "physik", erdkunde: "erdkunde", deutsch: "deutsch",
  geschichte: "geschichte", politik: "politik", kunst: "kunst",
  chemie: "chemie", mathe: "mathe", musik: "musik",
};

function fail(msg) { console.error("FEHLER: " + msg); process.exit(1); }

// Zeile aus Notion-Export -> DATA-Objekt (Format dashboard.html)
function mapRow(r) {
  const titel = r["Titel"] || fail("Zeile ohne Titel: " + JSON.stringify(r).slice(0, 120));
  if (r["Punkte"] === undefined || r["Punkte"] === null ||
      r["Maximum"] === undefined || r["Maximum"] === null) return null; // unbewertet -> kein Dashboard-Eintrag
  const fach = String(r["Fach"] || "").toLowerCase();
  const s = FACH_KEYS[fach];
  if (!s) fail("Unbekanntes Fach '" + r["Fach"] + "' in: " + titel + " -> FACH_KEYS erweitern (auch SUBJECTS/MASTERY im dashboard.html pruefen).");
  const date = r["date:Bearbeitet am:start"] || fail("Kein Bearbeitet-am-Datum in: " + titel);
  const note = String(r["Note"] || fail("Keine Note in: " + titel));
  const tendenz = String(r["Tendenz"] || "").trim();
  // gnote = Note + Kern der Tendenz (bis zum ersten ";") – Rest bleibt in der DB dokumentiert
  const tendenzKurz = tendenz.split(";")[0].trim();
  const gnote = tendenzKurz ? note + " (" + tendenzKurz + ")" : note;
  const bonus = String(r["Bonus"] || "").trim();
  // type/title: Override-Felder, sonst aus Typ+Titel ableiten
  let type = String(r["Dashboard-Typ"] || "").trim();
  let title = String(r["Dashboard-Titel"] || "").trim();
  if (!type || !title) {
    const derived = deriveTypeTitle(String(r["Typ"] || ""), titel, String(r["Fach"] || ""));
    if (!type) type = derived.type;
    if (!title) title = derived.title;
  }
  const info = String(r["Dashboard-Info"] || "").trim() || "TODO: Dashboard-Info in der Notion-DB ergänzen (" + titel + ")";
  const pts = Number(r["Punkte"]), max = Number(r["Maximum"]);
  if (!(pts >= 0) || !(max > 0) || pts > max) fail("Punkte/Maximum unplausibel in: " + titel + " (" + pts + "/" + max + ")");
  return { date: date, s: s, type: type, title: title, pts: pts, max: max, grade: note, gnote: gnote, bonus: bonus || null, info: info, _titel: titel };
}

// Fallback: "Chemie – Probeklausur 4 (Analysieren und Bilanzieren)" -> type "Probeklausur 4", title "Analysieren und Bilanzieren"
function deriveTypeTitle(typ, titel, fach) {
  let rest = titel;
  const pfx = fach + " – ";
  if (rest.toLowerCase().startsWith(pfx.toLowerCase())) rest = rest.slice(pfx.length);
  let type = typ;
  const m = rest.match(/^(Probeklausur|Klausur|Übungsblatt|Klausur-Format|Hausaufgabe|Klassenarbeit)\s*(\d+)?\s*(.*)$/);
  if (m) {
    type = (m[1] + (m[2] ? " " + m[2] : "")).trim();
    rest = m[3] || rest;
  }
  let title = rest.trim();
  if (title.startsWith("(") && title.endsWith(")")) title = title.slice(1, -1).trim();
  return { type: type || typ, title: title || titel };
}

function renderData(rows) {
  const lines = rows.map(r => {
    const parts = [
      "date:" + JSON.stringify(r.date),
      "s:" + JSON.stringify(r.s),
      "type:" + JSON.stringify(r.type),
      "title:" + JSON.stringify(r.title),
      "pts:" + r.pts,
      "max:" + r.max,
      "grade:" + JSON.stringify(r.grade),
      "gnote:" + JSON.stringify(r.gnote),
      "bonus:" + JSON.stringify(r.bonus),
      "info:" + JSON.stringify(r.info),
    ];
    return "  {" + parts.join(", ") + "}";
  });
  return "const DATA = [\n" + lines.join(",\n") + ",\n];";
}

// Vorhandenen DATA-Block aus einer src-Datei lesen (lokal, vertrauenswürdig)
function parseExisting(src) {
  const m = src.match(/const DATA = \[([\s\S]*?)\n\];/);
  if (!m) fail("Kein 'const DATA = [...]'-Block gefunden – ist die Datei verschluesselt (site/) oder das Format geaendert?");
  const rows = new Function("return [" + m[1] + "];")();
  return { rows: rows, full: m[0], start: m.index, end: m.index + m[0].length };
}

function keyOf(r) { return r.date + "|" + r.s + "|" + r.type + "|" + r.title; }
// Noten-Strings normalisieren wie dashboard.html (noteKey): U+2212/U+2013/U+2014 -> "-"
function noteKey(n) { return String(n).trim().replace(/[−–—]/g, "-"); }

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) fail("Nutzung: node sync/lernfabrik_sync.js <export.json> [--check|--write] <pfad>");
  const exportPath = args[0];
  const mode = args[1] === "--check" || args[1] === "--write" ? args[1] : null;
  const targetPath = mode ? args[2] : null;
  const ex = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  const raw = ex.results || fail("export.json hat kein results-Array (Notion query_data_sources rows-Modus?).");
  const rows = raw.map(mapRow).filter(Boolean).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const genBlock = renderData(rows);
  const warnings = rows.filter(r => r.info.startsWith("TODO:")).map(r => "  - " + r._titel);
  console.log("Abgeleitete DATA-Zeilen: " + rows.length);
  if (warnings.length) console.log("Offene Dashboard-Info (TODO):\n" + warnings.join("\n"));

  if (!mode) { console.log("\n" + genBlock + "\n"); return; }
  const src = fs.readFileSync(targetPath, "utf8");
  const old = parseExisting(src);
  const oldKeys = new Set(old.rows.map(keyOf));
  const newKeys = new Set(rows.map(keyOf));
  const fehlend = old.rows.filter(r => !newKeys.has(keyOf(r)));
  const neu = rows.filter(r => !oldKeys.has(keyOf(r)));
  const diffPkt = rows.filter(r => { const o = old.rows.find(x => keyOf(x) === keyOf(r)); return o && (o.pts !== r.pts || o.max !== r.max || noteKey(o.grade) !== noteKey(r.grade)); });
  console.log("Vorhanden in Datei: " + old.rows.length + " | Neu aus Notion: " + rows.length +
    " | fehlend in Datei: " + fehlend.length + " | neu: " + neu.length + " | Punkte/Noten-Abweichungen: " + diffPkt.length);
  for (const r of fehlend) console.log("  FEHLT in Notion-DB (nur in Datei): " + keyOf(r));
  for (const r of neu) console.log("  NEU aus Notion-DB: " + keyOf(r));
  for (const r of diffPkt) console.log("  ABWEICHEND: " + keyOf(r));

  if (mode === "--write") {
    if (fehlend.length) fail("Abbruch: Datei enthaelt Zeilen, die NICHT in der Notion-DB liegen – erst klaeren (Notion-DB ist fuehrende Quelle).");
    if (!neu.length && !diffPkt.length) { console.log("Nichts zu aendern – Datei ist aktuell."); return; }
    const out = src.slice(0, old.start) + genBlock + src.slice(old.end);
    fs.writeFileSync(targetPath, out, "utf8");
    console.log("DATA-Block ersetzt in: " + targetPath);
    console.log("Weiter: encrypt -> verify -> leakcheck -> push (siehe sync/README.md)");
  }
}
main();
