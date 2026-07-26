/* ============================================================
   Konverter- & Speicher-Server
   - liefert das statische Frontend aus (/)
   - POST /api/convert : nimmt .dwg/.dxf entgegen, gibt DXF-Text zurück
     .dwg -> DXF via LibreDWG (dwg2dxf)
   - Standortmodelle dauerhaft speichern (DATA_DIR, Docker-Volume):
       GET    /api/models          Liste aller gespeicherten Modelle
       GET    /api/models/:id      ein Modell (DXF-Text + Leitungen)
       POST   /api/models          neues Modell speichern {name,dxf,pipes}
       PUT    /api/models/:id/pipes  nur die Leitungen aktualisieren {pipes}
       DELETE /api/models/:id      Modell löschen
   ============================================================ */
const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_MB = parseInt(process.env.MAX_MB || '40', 10);

// ----- Datenspeicher (dauerhaft über Docker-Volume) -----
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MODELS_DIR = path.join(DATA_DIR, 'models');
fs.mkdirSync(MODELS_DIR, { recursive: true });
const INDEX_FILE = path.join(DATA_DIR, 'models.json');

function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); }
  catch (e) { return []; }
}
function writeIndex(arr) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(arr, null, 2));
}
function safeId(id) { return String(id || '').replace(/[^a-z0-9_-]/gi, ''); }

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_MB * 1024 * 1024 }
});

// JSON-Body (DXF-Text + Leitungen können groß sein)
app.use(express.json({ limit: '80mb' }));

// Frontend ausliefern
const FRONTEND = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ------------------------------------------------------------
//  DWG/DXF -> DXF-Text
// ------------------------------------------------------------
app.post('/api/convert', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('Keine Datei empfangen.');
  const orig = (req.file.originalname || '').toLowerCase();
  const tmpIn = req.file.path;

  const cleanup = (extra) => {
    fs.unlink(tmpIn, () => {});
    if (extra) fs.unlink(extra, () => {});
  };

  // DXF direkt durchreichen
  if (orig.endsWith('.dxf')) {
    fs.readFile(tmpIn, 'utf8', (err, data) => {
      cleanup();
      if (err) return res.status(500).send('Datei konnte nicht gelesen werden.');
      res.type('text/plain').send(data);
    });
    return;
  }

  if (!orig.endsWith('.dwg')) {
    cleanup();
    return res.status(400).send('Nur .dwg oder .dxf werden unterstützt.');
  }

  // DWG -> DXF über LibreDWG
  const outPath = path.join(os.tmpdir(), 'conv_' + crypto.randomBytes(6).toString('hex') + '.dxf');
  execFile('dwg2dxf', ['-o', outPath, tmpIn], { timeout: 90000 }, (err, _stdout, stderr) => {
    fs.readFile(outPath, 'utf8', (rErr, data) => {
      cleanup(outPath);
      if (rErr || !data) {
        console.error('dwg2dxf fehlgeschlagen:', err && err.message, stderr);
        return res.status(422).send(
          'DWG konnte nicht umgewandelt werden. Möglicherweise eine sehr neue/exotische DWG-Version. ' +
          'Alternativ die Datei im CAD als DXF exportieren. Details: ' + ((stderr || '').slice(0, 300))
        );
      }
      res.type('text/plain').send(data);
    });
  });
});

// ------------------------------------------------------------
//  Standortmodelle: dauerhaft speichern / laden
// ------------------------------------------------------------
app.get('/api/models', (_req, res) => {
  res.json(readIndex());
});

app.get('/api/models/:id', (req, res) => {
  const id = safeId(req.params.id);
  const dxfP = path.join(MODELS_DIR, id + '.dxf');
  const pipesP = path.join(MODELS_DIR, id + '.pipes.json');
  if (!id || !fs.existsSync(dxfP)) return res.status(404).json({ error: 'Modell nicht gefunden.' });
  let dxf = '';
  try { dxf = fs.readFileSync(dxfP, 'utf8'); } catch (e) { return res.status(500).json({ error: 'Lesefehler.' }); }
  let pipes = [];
  try { pipes = JSON.parse(fs.readFileSync(pipesP, 'utf8')); } catch (e) { pipes = []; }
  let data = {};
  try { data = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, id + '.data.json'), 'utf8')); } catch (e) { data = {}; }
  const meta = readIndex().find(m => m.id === id) || {};
  res.json({ id, name: meta.name || 'Standortmodell', dxf, pipes, layerData: data.layerData || {}, layerCfg: data.layerCfg || {}, objectData: data.objectData || {} });
});

app.post('/api/models', (req, res) => {
  const body = req.body || {};
  const dxf = body.dxf;
  if (!dxf || typeof dxf !== 'string') return res.status(400).json({ error: 'Kein DXF-Inhalt übergeben.' });
  const pipes = Array.isArray(body.pipes) ? body.pipes : [];
  const id = 'm' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const data = { layerData: (body.layerData && typeof body.layerData === 'object') ? body.layerData : {},
                 layerCfg: (body.layerCfg && typeof body.layerCfg === 'object') ? body.layerCfg : {},
                 objectData: (body.objectData && typeof body.objectData === 'object') ? body.objectData : {} };
  try {
    fs.writeFileSync(path.join(MODELS_DIR, id + '.dxf'), dxf);
    fs.writeFileSync(path.join(MODELS_DIR, id + '.pipes.json'), JSON.stringify(pipes));
    fs.writeFileSync(path.join(MODELS_DIR, id + '.data.json'), JSON.stringify(data));
  } catch (e) {
    console.error('Speichern fehlgeschlagen:', e.message);
    return res.status(500).json({ error: 'Speichern auf dem Server fehlgeschlagen.' });
  }
  const idx = readIndex();
  const entry = { id, name: String(body.name || 'Standortmodell').slice(0, 120), created: new Date().toISOString() };
  idx.push(entry);
  writeIndex(idx);
  res.json({ ok: true, id, name: entry.name });
});

app.put('/api/models/:id/pipes', (req, res) => {
  const id = safeId(req.params.id);
  const dxfP = path.join(MODELS_DIR, id + '.dxf');
  if (!id || !fs.existsSync(dxfP)) return res.status(404).json({ error: 'Modell nicht gefunden.' });
  const pipes = Array.isArray((req.body || {}).pipes) ? req.body.pipes : [];
  try {
    fs.writeFileSync(path.join(MODELS_DIR, id + '.pipes.json'), JSON.stringify(pipes));
  } catch (e) {
    return res.status(500).json({ error: 'Aktualisieren fehlgeschlagen.' });
  }
  res.json({ ok: true, id, count: pipes.length });
});

// Generisches Update: aktualisiert nur die übergebenen Felder (Geometrie, Leitungen, Fachdaten, Layer-Konfig)
app.put('/api/models/:id', (req, res) => {
  const id = safeId(req.params.id);
  const dxfP = path.join(MODELS_DIR, id + '.dxf');
  if (!id || !fs.existsSync(dxfP)) return res.status(404).json({ error: 'Modell nicht gefunden.' });
  const body = req.body || {};
  try {
    if (typeof body.dxf === 'string' && body.dxf.length) fs.writeFileSync(dxfP, body.dxf);
    if (Array.isArray(body.pipes)) fs.writeFileSync(path.join(MODELS_DIR, id + '.pipes.json'), JSON.stringify(body.pipes));
    if (body.layerData !== undefined || body.layerCfg !== undefined || body.objectData !== undefined) {
      let data = {};
      try { data = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, id + '.data.json'), 'utf8')); } catch (e) { data = {}; }
      if (body.layerData !== undefined) data.layerData = body.layerData;
      if (body.layerCfg !== undefined) data.layerCfg = body.layerCfg;
      if (body.objectData !== undefined) data.objectData = body.objectData;
      fs.writeFileSync(path.join(MODELS_DIR, id + '.data.json'), JSON.stringify(data));
    }
    if (typeof body.name === 'string' && body.name.trim()) {
      const idx = readIndex(); const e = idx.find(m => m.id === id); if (e) { e.name = body.name.slice(0, 120); writeIndex(idx); }
    }
  } catch (e) {
    return res.status(500).json({ error: 'Aktualisieren fehlgeschlagen.' });
  }
  res.json({ ok: true, id });
});

app.delete('/api/models/:id', (req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Ungültige ID.' });
  fs.unlink(path.join(MODELS_DIR, id + '.dxf'), () => {});
  fs.unlink(path.join(MODELS_DIR, id + '.pipes.json'), () => {});
  fs.unlink(path.join(MODELS_DIR, id + '.data.json'), () => {});
  writeIndex(readIndex().filter(m => m.id !== id));
  res.json({ ok: true });
});

app.listen(PORT, () => console.log('Server läuft auf Port ' + PORT + ' · Daten in ' + DATA_DIR));
