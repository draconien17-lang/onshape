// Modèle paramétrique : un projet = une liste ordonnée de fonctionnalités (esquisses, extrusions).
import * as THREE from 'three';

let counter = 0;
export function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;
}

export function createProject() {
  return { name: 'Sans titre', features: [] };
}

// Pièce de départ pour ne pas démarrer sur un écran vide.
export function createDemoProject() {
  const p = createProject();
  p.name = 'Support de démo';
  const sk = addSketch(p, 'XY');
  sk.shapes.push({ type: 'rect', x: -20, y: -15, w: 40, h: 30, hole: false });
  sk.shapes.push({ type: 'circle', cx: 0, cy: 0, r: 6, hole: true });
  const ex = addExtrude(p, sk.id);
  ex.depth = 10;
  return p;
}

export function addSketch(p, plane = 'XY') {
  const n = p.features.filter((f) => f.type === 'sketch').length + 1;
  const f = { id: uid('s'), type: 'sketch', name: `Esquisse ${n}`, plane, shapes: [] };
  p.features.push(f);
  return f;
}

export function addExtrude(p, sketchId) {
  const n = p.features.filter((f) => f.type === 'extrude').length + 1;
  const f = { id: uid('e'), type: 'extrude', name: `Extrusion ${n}`, sketchId, depth: 10 };
  p.features.push(f);
  return f;
}

export function getFeature(p, id) {
  return p.features.find((f) => f.id === id) || null;
}

// Supprime une fonctionnalité, et les extrusions qui dépendent d'une esquisse supprimée.
export function removeFeature(p, id) {
  p.features = p.features.filter((f) => f.id !== id && !(f.type === 'extrude' && f.sketchId === id));
}

export function isValidProject(p) {
  return !!p && typeof p === 'object' && Array.isArray(p.features);
}

// --- Esquisse -> formes three.js -------------------------------------------

function center(s) {
  return s.type === 'rect' ? [s.x + s.w / 2, s.y + s.h / 2] : [s.cx, s.cy];
}

function bbox(s) {
  return s.type === 'rect'
    ? { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h }
    : { x0: s.cx - s.r, y0: s.cy - s.r, x1: s.cx + s.r, y1: s.cy + s.r };
}

function usable(s) {
  return s.type === 'rect' ? s.w > 0 && s.h > 0 : s.r > 0;
}

function toPath(s, Ctor) {
  const p = new Ctor();
  if (s.type === 'rect') {
    p.moveTo(s.x, s.y);
    p.lineTo(s.x + s.w, s.y);
    p.lineTo(s.x + s.w, s.y + s.h);
    p.lineTo(s.x, s.y + s.h);
    p.closePath();
  } else {
    p.absarc(s.cx, s.cy, s.r, 0, Math.PI * 2, false);
  }
  return p;
}

// Les formes pleines deviennent des contours ; chaque forme « trou » est percée
// dans la première forme pleine dont la boîte englobante contient son centre.
export function sketchToShapes(sketch) {
  const shapes = sketch.shapes.filter(usable);
  const solids = shapes.filter((s) => !s.hole).map((s) => ({ src: s, shape: toPath(s, THREE.Shape) }));
  for (const h of shapes.filter((s) => s.hole)) {
    const [cx, cy] = center(h);
    const host = solids.find(({ src }) => {
      const b = bbox(src);
      return cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1;
    });
    if (host) host.shape.holes.push(toPath(h, THREE.Path));
  }
  return solids.map((s) => s.shape);
}

function planeMatrix(plane) {
  const m = new THREE.Matrix4();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  if (plane === 'XZ') m.makeBasis(V(1, 0, 0), V(0, 0, 1), V(0, -1, 0));
  else if (plane === 'YZ') m.makeBasis(V(0, 1, 0), V(0, 0, 1), V(1, 0, 0));
  return m; // XY : identité
}

export function buildExtrudeGeometry(project, ext) {
  const sk = getFeature(project, ext.sketchId);
  if (!sk || sk.type !== 'sketch' || !(ext.depth > 0)) return null;
  const shapes = sketchToShapes(sk);
  if (!shapes.length) return null;
  const g = new THREE.ExtrudeGeometry(shapes, { depth: ext.depth, bevelEnabled: false, curveSegments: 48 });
  g.applyMatrix4(planeMatrix(sk.plane));
  return g;
}

export function buildAll(project) {
  const out = [];
  for (const f of project.features) {
    if (f.type !== 'extrude') continue;
    const geometry = buildExtrudeGeometry(project, f);
    if (geometry) out.push({ id: f.id, geometry });
  }
  return out;
}

// Triangles du projet entier (mm, Z haut), posés sur Z = 0, pour le slicer et l'export STL.
export function projectTriangles(project) {
  const chunks = [];
  let total = 0;
  for (const { geometry } of buildAll(project)) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const arr = g.getAttribute('position').array;
    chunks.push(arr);
    total += arr.length;
    if (g !== geometry) g.dispose();
    geometry.dispose();
  }
  const tri = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    tri.set(c, o);
    o += c.length;
  }
  let minZ = Infinity;
  for (let i = 2; i < tri.length; i += 3) minZ = Math.min(minZ, tri[i]);
  if (Number.isFinite(minZ)) for (let i = 2; i < tri.length; i += 3) tri[i] -= minZ;
  return tri;
}
