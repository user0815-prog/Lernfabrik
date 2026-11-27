#!/usr/bin/env node
/**
 * 🏭 Lernfabrik Encryptor
 * -----------------------
 * Verschluesselt eine Klarquelle (HTML) mit AES-256-GCM und bettet das
 * Chiffrat in den clientseitig entschluesselbaren Wrapper
 * (prompt_template.html) ein. Das Passwort kennt nur Max persoenlich;
 * es wird NIE committen und NIE in Ausgabedateien gespeichert.
 *
 * Aufruf (aus dem Repo-Wurzelverzeichnis):
 *   node encrypt.js <quelle> <ziel> "<Hinweistext>"
 *   Beispiel:
 *   node encrypt.js src/arena.html arena.html "Die Klausur-Arena ist verschlossen."
 *
 * Geheimnisse (lokal, niemals committen):
 *   salt.txt  -> 32 Hex-Zeichen (Salt, identisch zu build.json schema.salt_hex)
 *                Fallback: build.json schema.salt_hex
 *   pw.txt    -> Passwort (eine Zeile); Alternativen: Umgebungsvariable
 *                LF_PASS oder interaktive Abfrage
 *
 * Ablauf: Quelle -> gzip (Level 9) -> AES-256-GCM (IV 12 Byte zufaellig,
 * Schluessel via PBKDF2-SHA256, 310000 Iterationen) -> base64-JSON
 * {"i":IV,"d":ciphertext||tag} -> je 4000 Zeichen ein Chunk, Anfuehrungs-
 * zeichen je Chunk escaped -> Template-Marker @@PAYLOAD@@ / @@SALT@@ /
 * @@HINT@@ ersetzen.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const readline = require('readline');

const ITERATIONS = 310000; // identisch zum Browser-Pfad (build.json)
const CHUNK_SIZE = 4000;   // Zeichen pro Chunk (unescaped gemessen)
const DEFAULT_HINT = 'Willkommen in der verschlossenen Lernfabrik.';

function die(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

function readFirstExisting(...files) {
  for (const f of files) {
    try { return { path: f, data: fs.readFileSync(f, 'utf8') }; }
    catch (e) { /* naechster Kandidat */ }
  }
  return null;
}

/** Salt: 32 Hex-Zeichen oder Base64-Form (wie SALT_B64 im Wrapper). */
function parseSalt(text) {
  const t = text.trim();
  if (/^[0-9a-fA-F]{32}$/.test(t)) return Buffer.from(t, 'hex');
  try {
    const b = Buffer.from(t, 'base64');
    if (b.length === 16) return b;
  } catch (e) { /* fall through */ }
  die('salt.txt: 32 Hex-Zeichen (Salt) oder dessen Base64-Form erwartet, gelesen: "' + t.slice(0, 48) + '"');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function askPassword() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Passwort: ', (pw) => { rl.close(); resolve(pw); });
  });
}

async function main() {
  const [srcPath, outPath, hintArg] = process.argv.slice(2);
  if (!srcPath || !outPath) {
    console.error('Aufruf: node encrypt.js <quelle> <ziel> "<Hinweistext>"');
    console.error('Beispiel: node encrypt.js src/arena.html arena.html "Die Klausur-Arena ist verschlossen."');
    process.exit(1);
  }

  // Hinweistext (nur Plaintext, wird HTML-escaped); Standard: Landing-Page-Text
  const hint = (hintArg !== undefined && hintArg.trim() !== '')
    ? escapeHtml(hintArg.trim())
    : DEFAULT_HINT;

  const root = __dirname;

  // Salt: salt.txt im Arbeitsverzeichnis, dann neben dem Skript,
  // sonst Fallback build.json -> schema.salt_hex
  const saltFile = readFirstExisting(
    path.join(process.cwd(), 'salt.txt'),
    path.join(root, 'salt.txt')
  );
  let salt;
  if (saltFile) salt = parseSalt(saltFile.data);
  else {
    try {
      const build = JSON.parse(fs.readFileSync(path.join(root, 'build.json'), 'utf8'));
      salt = Buffer.from(build.schema.salt_hex, 'hex');
      console.log('ℹ Kein salt.txt gefunden – Salt aus build.json (schema.salt_hex) uebernommen.');
    } catch (e) {
      die('Kein salt.txt gefunden und build.json nicht lesbar.');
    }
  }

  // Passwort: pw.txt -> LF_PASS -> interaktive Abfrage
  const pwFile = readFirstExisting(
    path.join(process.cwd(), 'pw.txt'),
    path.join(root, 'pw.txt')
  );
  let password = pwFile ? pwFile.data.trim() : process.env.LF_PASS;
  if (!password) password = await askPassword();
  if (!password) die('Kein Passwort vorhanden (pw.txt / LF_PASS / Eingabe).');

  // Template laden
  const tplFile = readFirstExisting(
    path.join(root, 'prompt_template.html'),
    path.join(process.cwd(), 'prompt_template.html')
  );
  if (!tplFile) die('prompt_template.html nicht gefunden (neben encrypt.js erwartet).');
  let tpl = tplFile.data;

  // Sicherheitszaehlung: jeder Marker genau einmal
  for (const marker of ['@@PAYLOAD@@', '@@SALT@@', '@@HINT@@']) {
    const n = tpl.split(marker).length - 1;
    if (n !== 1) die('Template-Fehler: Marker ' + marker + ' kommt ' + n + 'x vor (erwartet: 1x).');
  }

  // Verschluesselung
  const plain = fs.readFileSync(srcPath);
  const gz = zlib.gzipSync(plain, { level: 9 });
  const iv = crypto.randomBytes(12);
  const subtle = crypto.webcrypto.subtle;

  const keyMat = await subtle.importKey(
    'raw', Buffer.from(password, 'utf8'), 'PBKDF2', false, ['deriveKey']
  );
  const aesKey = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ct = Buffer.from(
    await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, gz)
  );

  // Payload-JSON {"i":IV,"d":ciphertext||tag}, dann Chunking:
  // 4000 Zeichen des UNESCAPED Strings, Anfuehrungszeichen je Chunk escapen
  const payload = JSON.stringify({ i: iv.toString('base64'), d: ct.toString('base64') });
  const chunks = [];
  for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
    chunks.push(payload.slice(i, i + CHUNK_SIZE).replace(/"/g, '\\"'));
  }
  const expr = chunks.map((c) => '"' + c + '"').join(' +\n');

  // Template befuellen
  tpl = tpl.replace('"@@PAYLOAD@@"', expr);
  tpl = tpl.replace('@@SALT@@', salt.toString('base64'));
  tpl = tpl.replace('@@HINT@@', hint);

  fs.writeFileSync(outPath, tpl, 'utf8');

  const kb = (n) => (n / 1024).toFixed(1) + ' kB';
  console.log('✔ Verschluesselt: ' + srcPath + ' -> ' + outPath);
  console.log('  Quelle ' + plain.length + ' B, gzip ' + gz.length + ' B, Chiffrat ' + ct.length + ' B (' + kb(ct.length) + '), Datei ' + Buffer.byteLength(tpl, 'utf8') + ' B');
  console.log('  Payload ' + payload.length + ' Zeichen in ' + chunks.length + ' Chunk(s) (max. ' + CHUNK_SIZE + ' Zeichen je Chunk)');
  console.log('  Hinweis: "' + hintArg + '"');
}

main().catch((e) => die(e && e.message ? e.message : String(e)));
