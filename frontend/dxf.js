/* ============================================================
   Minimal DXF Parser (ASCII DXF)
   Unterstützt: LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC, 3DFACE
   + Layer-Tabelle (Name, Farbe). Läuft im Browser und in Node.
   Keine externen Abhängigkeiten.
   ============================================================ */
(function (global) {
  'use strict';

  // AutoCAD Color Index -> Hex (Grundfarben, Rest -> Default)
  var ACI = {
    1: '#ff4d4d', 2: '#ffd24d', 3: '#5ad65a', 4: '#4ddbdb',
    5: '#5a8bff', 6: '#e05ad6', 7: '#dfe7ef', 8: '#8a97a6', 9: '#c6d0da'
  };
  function aciColor(i) { return ACI[i] || '#c2ccd8'; }

  // Text -> Liste von {code, value}
  function tokenize(text) {
    var lines = text.split(/\r\n|\r|\n/);
    var pairs = [];
    for (var i = 0; i + 1 < lines.length; i += 2) {
      var code = parseInt(lines[i].trim(), 10);
      if (Number.isNaN(code)) continue;
      pairs.push({ code: code, value: lines[i + 1] });
    }
    return pairs;
  }

  // Datensätze (records) innerhalb einer benannten Section einsammeln.
  // Jeder Record beginnt bei einem Gruppencode 0.
  function recordsOf(pairs, sectionName) {
    var recs = [], inSec = false, cur = null;
    for (var k = 0; k < pairs.length; k++) {
      var code = pairs[k].code;
      var v = String(pairs[k].value).trim();
      if (code === 0 && v === 'SECTION') {
        var name = (pairs[k + 1] && pairs[k + 1].code === 2) ? String(pairs[k + 1].value).trim() : '';
        inSec = (name === sectionName);
        cur = null;
        continue;
      }
      if (code === 0 && v === 'ENDSEC') {
        if (inSec && cur) { recs.push(cur); cur = null; }
        inSec = false;
        continue;
      }
      if (!inSec) continue;
      if (code === 0) {
        if (cur) recs.push(cur);
        cur = { type: v, props: [] };
      } else if (cur) {
        cur.props.push({ code: code, value: pairs[k].value });
      }
    }
    if (cur && inSec) recs.push(cur);
    return recs;
  }

  function first(rec, code) {
    for (var i = 0; i < rec.props.length; i++) if (rec.props[i].code === code) return rec.props[i].value;
    return undefined;
  }
  function num(rec, code, def) {
    var v = first(rec, code);
    if (v === undefined) return def;
    var n = parseFloat(v);
    return Number.isNaN(n) ? def : n;
  }

  function parse(text) {
    var pairs = tokenize(text);

    // ---- Layer ----
    var layers = {};
    recordsOf(pairs, 'TABLES').forEach(function (r) {
      if (r.type !== 'LAYER') return;
      var name = (first(r, 2) || '0').trim();
      var col = num(r, 62, 7);
      layers[name] = { color: aciColor(Math.abs(col)) };
    });

    // ---- Entities ----
    var recs = recordsOf(pairs, 'ENTITIES');
    var entities = [];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    function track(x, y) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    function ensureLayer(name) {
      if (name && !layers[name]) layers[name] = { color: '#c2ccd8' };
    }

    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      var layer = (first(r, 8) || '0').trim();
      ensureLayer(layer);

      if (r.type === 'LINE') {
        var e = {
          type: 'LINE', layer: layer,
          x1: num(r, 10, 0), y1: num(r, 20, 0), z1: num(r, 30, 0),
          x2: num(r, 11, 0), y2: num(r, 21, 0), z2: num(r, 31, 0)
        };
        track(e.x1, e.y1); track(e.x2, e.y2);
        entities.push(e);

      } else if (r.type === 'CIRCLE') {
        var c = { type: 'CIRCLE', layer: layer, cx: num(r, 10, 0), cy: num(r, 20, 0), r: num(r, 40, 0) };
        track(c.cx - c.r, c.cy - c.r); track(c.cx + c.r, c.cy + c.r);
        entities.push(c);

      } else if (r.type === 'ARC') {
        var a = {
          type: 'ARC', layer: layer, cx: num(r, 10, 0), cy: num(r, 20, 0), r: num(r, 40, 0),
          a0: num(r, 50, 0), a1: num(r, 51, 360)
        };
        track(a.cx - a.r, a.cy - a.r); track(a.cx + a.r, a.cy + a.r);
        entities.push(a);

      } else if (r.type === 'LWPOLYLINE') {
        var flag = num(r, 70, 0);
        var verts = [], cx = null;
        for (var p = 0; p < r.props.length; p++) {
          if (r.props[p].code === 10) { cx = parseFloat(r.props[p].value); }
          else if (r.props[p].code === 20 && cx !== null) {
            var vy = parseFloat(r.props[p].value);
            verts.push({ x: cx, y: vy }); track(cx, vy); cx = null;
          }
        }
        entities.push({ type: 'POLYLINE', layer: layer, closed: (flag & 1) === 1, verts: verts });

      } else if (r.type === 'POLYLINE') {
        var flag2 = num(r, 70, 0);
        var verts2 = [];
        // nachfolgende VERTEX-Records bis SEQEND einsammeln
        var j = i + 1;
        while (j < recs.length && recs[j].type === 'VERTEX') {
          var vx = num(recs[j], 10, 0), vy2 = num(recs[j], 20, 0);
          verts2.push({ x: vx, y: vy2 }); track(vx, vy2);
          j++;
        }
        if (j < recs.length && recs[j].type === 'SEQEND') j++;
        i = j - 1;
        entities.push({ type: 'POLYLINE', layer: layer, closed: (flag2 & 1) === 1, verts: verts2 });

      } else if (r.type === '3DFACE') {
        var pts = [];
        for (var q = 0; q < 4; q++) {
          pts.push({ x: num(r, 10 + q, 0), y: num(r, 20 + q, 0), z: num(r, 30 + q, 0) });
          track(pts[q].x, pts[q].y);
        }
        entities.push({ type: '3DFACE', layer: layer, pts: pts });

      } else if (r.type === 'TEXT') {
        // Textbeschriftung – dient als Objekt-Kennung (Objekt-ID). Nicht in die Bounds einrechnen.
        var tv = (first(r, 1) || '').trim();
        if (tv) entities.push({ type: 'TEXT', layer: layer, x: num(r, 10, 0), y: num(r, 20, 0), z: num(r, 30, 0), text: tv });

      } else if (r.type === 'MTEXT') {
        // MTEXT: Text kann über Code 3 (Fortsetzung) + Code 1 verteilt sein
        var mt = '';
        for (var pm = 0; pm < r.props.length; pm++) {
          if (r.props[pm].code === 3) mt += r.props[pm].value;
          else if (r.props[pm].code === 1) mt += r.props[pm].value;
        }
        mt = mt.replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').replace(/\\P/g, ' ').trim();
        if (mt) entities.push({ type: 'TEXT', layer: layer, x: num(r, 10, 0), y: num(r, 20, 0), z: num(r, 30, 0), text: mt });
      }
    }

    if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }

    return {
      layers: layers,
      entities: entities,
      bounds: { minX: minX, minY: minY, maxX: maxX, maxY: maxY },
      stats: { entities: entities.length, layers: Object.keys(layers).length }
    };
  }

  var api = { parse: parse, aciColor: aciColor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.DXF = api;
})(typeof window !== 'undefined' ? window : globalThis);
