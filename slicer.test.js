import test from 'node:test';
import assert from 'node:assert/strict';
import { slice, crossSection, KOBRA_2_PRO } from '../src/slicer.js';
import { trianglesToBinarySTL } from '../src/stl.js';

function quad(out, a, b, c, d) {
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}

function box(x0, y0, z0, x1, y1, z1) {
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  const out = [];
  for (const f of faces) quad(out, v[f[0]], v[f[1]], v[f[2]], v[f[3]]);
  return new Float32Array(out);
}

// Tube carré : 20x20 à l'extérieur, trou de 10x10, hauteur 10
function tube() {
  const o = (z) => [[-10, -10, z], [10, -10, z], [10, 10, z], [-10, 10, z]];
  const i = (z) => [[-5, -5, z], [5, -5, z], [5, 5, z], [-5, 5, z]];
  const out = [];
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    quad(out, o(0)[k], o(0)[k2], o(10)[k2], o(10)[k]); // paroi extérieure
    quad(out, i(0)[k], i(0)[k2], i(10)[k2], i(10)[k]); // paroi intérieure
    quad(out, o(0)[k], o(0)[k2], i(0)[k2], i(0)[k]); // dessous
    quad(out, o(10)[k], o(10)[k2], i(10)[k2], i(10)[k]); // dessus
  }
  return new Float32Array(out);
}

test('un cube 20x20x10 donne 50 couches et un G-code valide', async () => {
  const { gcode, stats } = await slice(box(0, 0, 0, 20, 20, 10));
  assert.equal(stats.layers, 50);
  assert.ok(stats.filamentMm > 100);
  assert.ok(stats.timeSec > 60);
  assert.match(gcode, /G28/);
  assert.match(gcode, /M109 S200/);
  assert.match(gcode, /;LAYER:49/);
  for (const m of gcode.matchAll(/G[01] X([\d.]+) Y([\d.]+)/g)) {
    const x = Number(m[1]), y = Number(m[2]);
    assert.ok(x >= 0 && x <= KOBRA_2_PRO.bed.x, `X hors plateau : ${x}`);
    assert.ok(y >= 0 && y <= KOBRA_2_PRO.bed.y, `Y hors plateau : ${y}`);
  }
});

test('un tube donne un contour extérieur et un trou', () => {
  const loops = crossSection(tube(), 5);
  assert.equal(loops.length, 2);
  assert.equal(loops.filter((l) => l.hole).length, 1);
});

test('un tube est découpé sans erreur', async () => {
  const { stats } = await slice(tube());
  assert.equal(stats.layers, 50);
  assert.ok(stats.filamentMm > 0);
});

test('une pièce trop grande est refusée', async () => {
  await assert.rejects(() => slice(box(0, 0, 0, 300, 20, 10)), /trop grande/);
});

test("l'export STL a la bonne taille", () => {
  const tri = box(0, 0, 0, 1, 1, 1);
  const buf = trianglesToBinarySTL(tri);
  assert.equal(buf.byteLength, 84 + 12 * 50);
});

test('toutes les extrusions restent à l\'intérieur de la pièce (cube centré sur le plateau)', async () => {
  const { gcode } = await slice(box(0, 0, 0, 20, 20, 10));
  let n = 0;
  for (const line of gcode.split('\n')) {
    const m = line.match(/^G1 X([\d.]+) Y([\d.]+) E[\d.]+/);
    if (!m || line.includes('Z0.3')) continue;
    const x = Number(m[1]), y = Number(m[2]);
    assert.ok(x >= 99.9 && x <= 120.1 && y >= 99.9 && y <= 120.1, `extrusion hors pièce : ${line}`);
    n++;
  }
  assert.ok(n > 1000);
});

test('le tube garde son trou : aucune extrusion dans le vide central', async () => {
  const { gcode } = await slice(tube());
  for (const line of gcode.split('\n')) {
    const m = line.match(/^G1 X([\d.]+) Y([\d.]+) E[\d.]+/);
    if (!m) continue;
    const x = Number(m[1]) - 110, y = Number(m[2]) - 110;
    if (line.includes('Z0.3')) continue;
    assert.ok(!(Math.abs(x) < 4.9 && Math.abs(y) < 4.9), `extrusion dans le trou : ${line}`);
  }
});
