/* ============================================================
   Konverter-Server
   - liefert das statische Frontend aus (/)
   - POST /api/convert : nimmt .dwg/.dxf entgegen, gibt DXF-Text zurück
     .dwg -> DXF via LibreDWG (dwg2dxf)
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

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_MB * 1024 * 1024 }
});

// Frontend ausliefern
const FRONTEND = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

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
  // dwg2dxf: -y = ohne Rückfrage überschreiben, -o = Ausgabedatei
  execFile('dwg2dxf', ['-y', '-o', outPath, tmpIn], { timeout: 60000 }, (err, _stdout, stderr) => {
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

app.listen(PORT, () => console.log('Konverter-Server läuft auf Port ' + PORT));
