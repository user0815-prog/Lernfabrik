#!/usr/bin/env node
/**
 * 🏭 Lernfabrik Verifikator
 * -------------------------
 * Prueft alle in build.json gelisteten Seiten OHNE Argumente:
 *   node verify.js
 *
 * Je Seite:
 *   1. Chiffrat aus dem __PAY__-Ausdruck laden (mehrere Chunks erlaubt)
 *   2. Salt aus der Seite (SALT_B64) lesen und gegen build.json pruefen
 *   3. Mit Passwort (pw.txt / LF_PASS / Abfrage) entschluesseln:
 *      AES-256-GCM -> gunzip -> Klartext
 *   4. Falls die Klarquelle (src/...) lokal existiert: byte-genauer Abgleich
 *   5. Klartext-Spuren-Check: MARKER duerfen AUSSERHALB von __PAY__
 *      nicht vorkommen (Base64 kann sie zufaellig enthalten - dort sind
 *      sie harmlos)
 *   6. JS-Syntax-Check aller <script>-Bloecke (Kompilierung ohne Ausfuehrung)
 *   7. Zeilenlaengen-Check (groesste Zeile < 4100 Zeichen, siehe README)
 *
 * Exit-Code 0 nur, wenn alle Seiten alle Checks bestehen.
 * Fehlgeschlagene Entschluesselung = meist falsches Passwort.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const readline = require('readline');
const vm = require('vm');

const ITERATIONS = 310000;
const MAX_LINE = 4099; // groesste Zeile darf 4099 Zeichen nicht ueberschreiten

// Klartext-Marker, die im Wrapper (ausserhalb des __PAY__-Ausdrucks) niemals
// vorkommen duerfen. Hier bei Bedarf um Namen/Kuerzel ergaenzen:
const MARKERS = ['KGS'];

function readFirstExisting(...files) {
  for (const f of files) {
    try { return { path: f, data: fs.readFileSync(f, 'utf8') }; }
    catch (e) { /* naechster Kandidat */ }
  }
  return null;
}

function askPassword() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Passwort: ', (pw) => { rl.close(); resolve(pw); });
  });
}

/** Liefert {expr, ok} – expr ist der JS-Ausdruck hinter 'const __PAY__ ='. */
function extractPayExpr(text) {
  const m = text.match(/const __PAY__ = (.*?);\n/s);
  if (!m) return null;
  return m[1];
}

async function deriveKey(password, salt) {
  const subtle = crypto.webcrypto.subtle;
  const keyMat = await subtle.importKey(
    'raw', Buffer.from(password, 'utf8'), 'PBKDF2', false, ['deriveKey']
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

async function main() {
  const root = __dirname;
  let build;
  try {
    build = JSON.parse(fs.readFileSync(path.join(root, 'build.json'), 'utf8'));
  } catch (e) {
    console.error('✖ build.json nicht lesbar: ' + e.message);
    process.exit(1);
  }
  const saltSoll = Buffer.from(build.schema.salt_hex, 'hex');

  const pwFile = readFirstExisting(
    path.join(process.cwd(), 'pw.txt'),
    path.join(root, 'pw.txt')
  );
  let password = pwFile ? pwFile.data.trim() : process.env.LF_PASS;
  if (!password) password = await askPassword();
  if (!password) {
    console.error('✖ Kein Passwort vorhanden (pw.txt / LF_PASS / Eingabe).');
    process.exit(1);
  }

  let fehler = 0;
  for (const seite of build.seiten) {
    const name = seite.datei;
    const ergebnisse = [];
    const fail = (msg) => { ergebnisse.push('✖ ' + msg); fehler++; };
    const ok = (msg) => ergebnisse.push('  ✔ ' + msg);

    // Seiten-Datei: Wurzelverzeichnis, alternativ site/
    const datei = readFirstExisting(
      path.join(root, seite.datei),
      path.join(root, 'site', seite.datei)
    );
    if (!datei) {
      fail(name + ': Datei nicht gefunden (weder ' + seite.datei + ' noch site/' + seite.datei + ')');
      console.log(name + '\n' + ergebnisse.join('\n'));
      continue;
    }
    const text = datei.data;

    // 1) __PAY__-Ausdruck
    const expr = extractPayExpr(text);
    if (!expr) { fail(name + ': kein __PAY__-Ausdruck gefunden'); console.log(name + '\n' + ergebnisse.join('\n')); continue; }
    let payloadStr;
    try {
      payloadStr = vm.runInNewContext('(' + expr + ')');
    } catch (e) {
      fail(name + ': __PAY__-Ausdruck ist kein gueltiges JS: ' + e.message);
      console.log(name + '\n' + ergebnisse.join('\n'));
      continue;
    }
    let payload;
    try {
      payload = JSON.parse(payloadStr);
    } catch (e) {
      fail(name + ': __PAY__ ist kein gueltiges JSON: ' + e.message);
      console.log(name + '\n' + ergebnisse.join('\n'));
      continue;
    }
    ok('__PAY__: ' + expr.length + ' Zeichen Ausdruck, JSON mit Schluesseln ' + Object.keys(payload).join(','));

    // 2) Salt pruefen
    const saltM = text.match(/const SALT_B64 = "([^"]+)"/);
    if (!saltM) fail(name + ': SALT_B64 nicht gefunden');
    else {
      const saltIst = Buffer.from(saltM[1], 'base64');
      if (saltIst.equals(saltSoll)) ok('Salt identisch mit build.json');
      else fail(name + ': SALT_B64 weicht von build.json ab');
    }

    // 3) Entschluesseln
    let plain = null;
    try {
      const key = await deriveKey(password, saltSoll);
      const iv = Buffer.from(payload.i, 'base64');
      const data = Buffer.from(payload.d, 'base64');
      if (iv.length !== 12) throw new Error('IV hat ' + iv.length + ' Byte (erwartet 12)');
      const gz = Buffer.from(await crypto.webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 }, key, data
      ));
      plain = zlib.gunzipSync(gz);
      ok('Entschluesselung ok: ' + plain.length + ' Byte Klartext');
    } catch (e) {
      fail('Entschluesselung fehlgeschlagen (falsches Passwort? zerstoerte Datei?): ' + e.message);
    }

    // 4) Abgleich mit Klarquelle, falls lokal vorhanden
    const quelle = path.join(root, seite.quelle);
    if (plain !== null && fs.existsSync(quelle)) {
      const src = fs.readFileSync(quelle);
      if (src.equals(plain)) ok('Klartext byte-identisch mit ' + seite.quelle);
      else fail('Klartext weicht von ' + seite.quelle + ' ab (' + plain.length + ' vs. ' + src.length + ' Byte)');
    } else if (plain !== null) {
      ok('Klarquelle ' + seite.quelle + ' lokal nicht vorhanden – Abgleich uebersprungen');
    }

    // 5) Klartext-Spuren AUSSERHALB des __PAY__-Ausdrucks
    const wrapperOnly = text.replace('const __PAY__ = ' + expr + ';', 'const __PAY__ = "";');
    for (const mk of MARKERS) {
      if (wrapperOnly.includes(mk)) {
        fail('Klartext-Spur "' + mk + '" ausserhalb von __PAY__ gefunden!');
      }
    }
    if (!ergebnisse.some((z) => z.startsWith('✖') && z.includes('Klartext-Spur'))) {
      ok('Keine Klartext-Spuren (' + MARKERS.join(', ') + ') im Wrapper');
    }

    // 6) JS-Syntax-Check der <script>-Bloecke
    const blocks = [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((b) => b.trim() !== '');
    let jsOk = true;
    blocks.forEach((code, idx) => {
      try { new vm.Script(code); } catch (e) {
        jsOk = false;
        fail(name + ': Syntaxfehler in <script>-Block ' + (idx + 1) + ': ' + e.message);
      }
    });
    if (jsOk) ok(blocks.length + ' <script>-Bloecke syntaktisch gueltig');

    // 7) Zeilenlaengen
    const maxLen = Math.max(...text.split('\n').map((l) => l.length));
    if (maxLen > MAX_LINE) fail('Zeile mit ' + maxLen + ' Zeichen zu lang (max. ' + MAX_LINE + ')');
    else ok('Laengste Zeile ' + maxLen + ' Zeichen (Grenze ' + MAX_LINE + ')');

    console.log(name + '\n' + ergebnisse.join('\n'));
  }

  if (fehler > 0) {
    console.log('\n✖ ' + fehler + ' Problem(e) gefunden.');
    process.exit(1);
  }
  console.log('\n✔ Alle Seiten verifiziert.');
}

main().catch((e) => { console.error('✖ ' + (e && e.message ? e.message : String(e))); process.exit(1); });
