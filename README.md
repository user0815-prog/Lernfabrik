# 🏭 Lernfabrik

Gehostetes Lernportal (Nachhilfe Klasse 11) auf **GitHub Pages**:
https://user0815-prog.github.io/Lernfabrik/

Diese Seiten enthalten **keine klaren Lerninhalte**. Alle Nutzdaten (Fragen, Noten, Chronik, Namen)
liegen als AES-256-GCM-Chiffrat im HTML eingebettet und werden erst im Browser nach Passwort-Eingabe
entschlüsselt:

- **PBKDF2-SHA256**, 310.000 Iterationen, fester Salt (siehe `build.json`)
- **AES-256-GCM** mit zufälliger IV pro Build
- Inhaltskompression per **gzip** (Browser `DecompressionStream`, ab iOS 16.4 / moderne Browser)
- Passwort optional pro Gerät gespeichert (`localStorage`), sonst pro Sitzung

## Inhalt

| Seite | Inhalt |
|---|---|
| `index.html` | Landing Page (Kacheln) – ebenfalls verschlüsselt |
| `arena.html` | Klausur-Arena: Quiz, Probeklausuren, Themen-Training, Karteikasten, Feedback |
| `dashboard.html` | Lernfortschritt-Dashboard: Noten-Zeitreihe, Stärken, Baustellen |

## Struktur

```
site/                <- deployed (GitHub Pages, Quelle: GitHub Actions)
  index.html, arena.html, dashboard.html   (Chiffrat + Entschlüsselungs-UI)
  .nojekyll
  .github/workflows/pages.yml               (Deploy-Workflow)
  build.json           (Salt, Iterationen, Update-Prozess; KEIN Passwort)
src/                 <- Klartextquellen (nicht deployed)
```

Hinweis: `src/` und die Build-Skripte liegen außerhalb dieses Repos.

<!-- deploy-trigger: Pages aktiviert 23.11.2026 -->
