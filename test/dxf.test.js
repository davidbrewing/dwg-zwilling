const fs = require('fs');
const path = require('path');
const DXF = require('../frontend/dxf.js');

const text = fs.readFileSync(path.join(__dirname, 'sample.dxf'), 'utf8');
const m = DXF.parse(text);

let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? '  (' + extra + ')' : ''));
  if (!cond) failures++;
}

check('2 Layer erkannt', m.stats.layers === 2, 'layers=' + m.stats.layers);
check('Layer WALLS Farbe rot', m.layers.WALLS && m.layers.WALLS.color === '#ff4d4d', JSON.stringify(m.layers.WALLS));
check('5 Entities', m.entities.length === 5, 'n=' + m.entities.length);

const line = m.entities.find(e => e.type === 'LINE');
check('LINE Endpunkt x2=10', line && line.x2 === 10);

const poly = m.entities.filter(e => e.type === 'POLYLINE');
const lw = poly.find(p => p.closed === true);
check('LWPOLYLINE geschlossen mit 4 Punkten', lw && lw.verts.length === 4, lw ? lw.verts.length : 'none');
check('LWPOLYLINE Punkt3 = (10,5)', lw && lw.verts[2].x === 10 && lw.verts[2].y === 5);

const oldpoly = poly.find(p => p.closed === false);
check('POLYLINE/VERTEX mit 2 Punkten', oldpoly && oldpoly.verts.length === 2, oldpoly ? oldpoly.verts.length : 'none');
check('POLYLINE Punkt2 = (3,4)', oldpoly && oldpoly.verts[1].x === 3 && oldpoly.verts[1].y === 4);

const circle = m.entities.find(e => e.type === 'CIRCLE');
check('CIRCLE r=1.5', circle && circle.r === 1.5);

const arc = m.entities.find(e => e.type === 'ARC');
check('ARC a1=90', arc && arc.a1 === 90);

check('Bounds korrekt (0..10, 0..5)',
  m.bounds.minX === 0 && m.bounds.maxX === 10 && m.bounds.minY === 0 && m.bounds.maxY === 5,
  JSON.stringify(m.bounds));

console.log('\n' + (failures === 0 ? 'ALLE TESTS BESTANDEN' : failures + ' TEST(S) FEHLGESCHLAGEN'));
process.exit(failures === 0 ? 0 : 1);
