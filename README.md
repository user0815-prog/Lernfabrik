# 🏭 Lernfabrik

Verschlüsseltes Lernportal für die Nachhilfe Klasse 11 – gehostet via GitHub Pages.

🔗 **https://user0815-prog.github.io/Lernfabrik/**

## Pages dieser Site

| Seite | Inhalt |
| --- | --- |
| `index.html` | Landing Page mit drei Kacheln (Arena, Noten, Lernfortschritt) |
| `arena.html` | Klausur-Arena: Quiz, Karteikarten, offene Fragen, XP/Streak (v2, 22.11.2026) |
| `noten.html` | Noten-App: Fächer, Noten 0–15, Kategorien, Zeugnis-Hochrechnung (Klasse 11, HJ1/HJ2) |
| `dashboard.html` | Lernfortschritt: Chronik der bewerteten Arbeiten + mündliche Noten live aus der Noten-App |

## Verschlüsselung

Alle Seiten sind **clientseitig verschlüsselt**:

- AES-256-GCM, Schlüssel via PBKDF2-SHA256 (**310 000 Iterationen**) aus Passwort + Salt
- Salt (hex): `c808f9eb91a124a3bb5be08240e9bb42` wiederverwendet für Konsistenz über alle Releases
- Nutzdaten: gzip (Level 9) vor der Verschlüsselung; Browser-Pfad: DecompressionStream (ab iOS 16.4, sonst Upgrade-Hinweis)
- Payload: base64-JSON `{i: IV, d: ciphertext‖tag}` als `__PAY__` in 4000-Zeichen-Chunks
- Passwort: gilt nur Max persönlich, ist **nicht** in diesem Repo und wird nie dokumentiert
- „Auf diesem Gerät speichern" → localStorage-Schlüssel `lf-secret` (AUTO-Login beim nächsten Besuch)

Das Repo enthält **ausschließlich Chiffrat** – kein Klartext, keine personenbezogenen Daten.

## Update-Prozess (neue Version einer Seite)

1. Klarquelle nach `/src` (nicht committen), Salt in `salt.txt`, Passwort in `pw.txt` (beide lokal, niemals committen).
2. `node encrypt.js src/<seite>.html site/<seite>.html "<Hinweistext>"`
3. `node verify.js` – Entschlüsselung muss 1:1 der Quelle entsprechen, keine Klartext-Spuren.
4. `site/` committen und pushen – GitHub-Actions-Workflow deployt automatisch nach GitHub Pages.

## Gemeinsamer Datenspeicher

Die Noten-App speichert unter localStorage-Schlüssel `lfNotenV1` (Version 1, Klasse 11).
Das Lernfortschritt-Dashboard liest daraus live alle mündlichen Noten (Zwischen-/Endnoten,
Teilnoten, Extraleistungen) und die je-Fach-Gewichtung `f.gew` (Prozentanteil schriftlich).
