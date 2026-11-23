// Slicer en JavaScript pur (aucune dépendance) : triangles -> G-code Marlin.
// Les triangles sont un Float32Array [x,y,z, x,y,z, x,y,z, ...] en millimètres, Z vers le haut.

export const KOBRA_2_PRO = {
  name: 'Anycubic Kobra 2 Pro',
  bed: { x: 220, y: 220, z: 250 },
  nozzle: 0.4,
  filamentDiameter: 1.75,
};

export const DEFAULT_SETTINGS = {
  layerHeight: 0.2,
  firstLayerHeight: 0.2,
  lineWidth: 0.42,
  perimeters: 2,
  bottomLayers: 4,
  topLayers: 5,
  infill: 0.15, // fraction 0..1
  nozzleTemp: 200,
  bedTemp: 60,
  speedFirst: 20,
  speedPerimeter: 40,
  speedInfill: 60,
  speedTravel: 150,
  retraction: 0.8,
  retractionSpeed: 35,
  fanFromLayer: 2, // ventilateur à partir de la couche n°2
  autoLevel: true, // G29 après G28
  flow: 1.0,
};

// ---------------------------------------------------------------------------
// Géométrie 2D
// ---------------------------------------------------------------------------

function signedArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i][0] * p[j][1] - p[j][0] * p[i][1];
  }
  return a / 2;
}

function pointInPoly(pt, p) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Retire les sommets alignés (les diagonales des faces du maillage en créent)
// et ceux qui font demi-tour, pour que les décalages restent propres.
function simplifyLoop(pts, tol = 0.002) {
  const p = pts.slice();
  let changed = true;
  while (changed && p.length > 3) {
    changed = false;
    for (let i = 0; i < p.length && p.length > 3; i++) {
      const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const dx = c[0] - a[0], dy = c[1] - a[1];
      const l = Math.hypot(dx, dy);
      const dev = l < 1e-9 ? Math.hypot(b[0] - a[0], b[1] - a[1]) : Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / l;
      if (dev < tol) { p.splice(i, 1); i--; changed = true; }
    }
  }
  return p;
}

function cleanLoop(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-4) out.pop();
  }
  return simplifyLoop(out);
}

// Quand une arête courte est plus petite que le décalage, elle s'inverse :
// on supprime alors le sommet fautif.
function dropInverted(orig, off) {
  const o = off.slice(), q = orig.slice();
  let changed = true;
  while (changed && o.length > 3) {
    changed = false;
    for (let i = 0; i < o.length; i++) {
      const j = (i + 1) % o.length;
      const dx = o[j][0] - o[i][0], dy = o[j][1] - o[i][1];
      const ox = q[j][0] - q[i][0], oy = q[j][1] - q[i][1];
      if (dx * ox + dy * oy < 0) { o.splice(j, 1); q.splice(j, 1); changed = true; break; }
    }
  }
  return o;
}

// Décale une boucle vers sa gauche de d mm (intérieur de la matière, car
// les contours extérieurs sont anti-horaires et les trous horaires).
function offsetLoop(pts, d) {
  const p = cleanLoop(pts);
  const n = p.length;
  if (n < 3) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n];
    let e1x = b[0] - a[0], e1y = b[1] - a[1];
    const l1 = Math.hypot(e1x, e1y) || 1;
    e1x /= l1; e1y /= l1;
    let e2x = c[0] - b[0], e2y = c[1] - b[1];
    const l2 = Math.hypot(e2x, e2y) || 1;
    e2x /= l2; e2y /= l2;
    const n1x = -e1y, n1y = e1x, n2x = -e2y, n2y = e2x;
    const k = 1 / Math.max(1 + n1x * n2x + n1y * n2y, 0.25); // plafonne les pointes
    out.push([b[0] + (n1x + n2x) * k * d, b[1] + (n1y + n2y) * k * d]);
  }
  return dropInverted(p, out);
}

function offsetValid(orig, off, hole) {
  if (!off) return false;
  const a0 = signedArea(orig), a1 = signedArea(off);
  if (Math.sign(a0) !== Math.sign(a1)) return false;
  if (Math.abs(a1) < 0.05) return false;
  return hole ? Math.abs(a1) > Math.abs(a0) : Math.abs(a1) < Math.abs(a0);
}

function offsetLoops(loops, d) {
  const out = [];
  for (const l of loops) {
    const off = offsetLoop(l.pts, d);
    if (offsetValid(l.pts, off, l.hole)) out.push({ pts: off, hole: l.hole });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coupe d'un maillage par un plan horizontal
// ---------------------------------------------------------------------------

function edgePoint(t, ia, ib, z, out) {
  let za = t[ia + 2], zb = t[ib + 2];
  if ((za < z) === (zb < z)) return;
  if (za > zb) { const tmp = ia; ia = ib; ib = tmp; za = t[ia + 2]; zb = t[ib + 2]; }
  const k = (z - za) / (zb - za);
  out.push(t[ia] + k * (t[ib] - t[ia]), t[ia + 1] + k * (t[ib + 1] - t[ia + 1]));
}

function buildLoops(segs) {
  const key = (x, y) => Math.round(x * 1000) + ',' + Math.round(y * 1000);
  const map = new Map();
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s0 = segs[i];
    const startK = key(s0[0], s0[1]);
    const pts = [[s0[0], s0[1]]];
    let cur = [s0[2], s0[3]];
    let curK = key(cur[0], cur[1]);
    let closed = true;
    while (curK !== startK) {
      let next = -1;
      for (const j of map.get(curK) || []) if (!used[j]) { next = j; break; }
      if (next < 0) { closed = false; break; }
      used[next] = 1;
      const s = segs[next];
      const far = key(s[0], s[1]) === curK ? [s[2], s[3]] : [s[0], s[1]];
      pts.push(cur);
      cur = far;
      curK = key(far[0], far[1]);
    }
    if (closed && pts.length >= 3) loops.push(pts);
  }
  return loops;
}

// Contours extérieurs anti-horaires, trous horaires (imbrication par parité).
function orientLoops(loops) {
  const items = loops
    .map((pts) => ({ pts, area: signedArea(pts) }))
    .filter((l) => Math.abs(l.area) > 1e-4);
  return items.map((it, i) => {
    let depth = 0;
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      if (Math.abs(items[j].area) > Math.abs(it.area) && pointInPoly(it.pts[0], items[j].pts)) depth++;
    }
    const hole = depth % 2 === 1;
    const pts = it.area > 0 === hole ? it.pts.slice().reverse() : it.pts;
    return { pts, hole };
  });
}

export function crossSection(tri, z) {
  const segs = [];
  for (let i = 0; i < tri.length; i += 9) {
    const az = tri[i + 2], bz = tri[i + 5], cz = tri[i + 8];
    if ((az < z && bz < z && cz < z) || (az >= z && bz >= z && cz >= z)) continue;
    const pts = [];
    edgePoint(tri, i, i + 3, z, pts);
    edgePoint(tri, i + 3, i + 6, z, pts);
    edgePoint(tri, i + 6, i, z, pts);
    if (pts.length === 4) segs.push(pts);
  }
  return orientLoops(buildLoops(segs));
}

// ---------------------------------------------------------------------------
// Remplissage
// ---------------------------------------------------------------------------

function infillLines(loops, angle, spacing) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const rot = loops.map((l) => l.map(([x, y]) => [x * c + y * s, -x * s + y * c]));
  const back = ([x, y]) => [x * c - y * s, x * s + y * c];
  let minY = Infinity, maxY = -Infinity;
  for (const l of rot) for (const p of l) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const out = [];
  let k = 0;
  for (let y = Math.ceil(minY / spacing) * spacing; y <= maxY; y += spacing, k++) {
    const xs = [];
    for (const l of rot) {
      for (let i = 0; i < l.length; i++) {
        const [x0, y0] = l[i], [x1, y1] = l[(i + 1) % l.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    const line = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] < 0.3) continue;
      let a = [xs[i], y], b = [xs[i + 1], y];
      if (k % 2) [a, b] = [b, a];
      line.push([back(a), back(b)]);
    }
    if (k % 2) line.reverse();
    out.push(...line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Écriture du G-code
// ---------------------------------------------------------------------------

class Writer {
  constructor(s, m) {
    this.s = s;
    this.m = m;
    this.out = [];
    this.x = 0;
    this.y = 0;
    this.time = 0;
    this.filament = 0;
    this.retracted = false;
    this.area = Math.PI * (m.filamentDiameter / 2) ** 2;
  }
  line(t) { this.out.push(t); }
  retract() {
    if (this.retracted || this.s.retraction <= 0) return;
    this.line(`G1 E${(-this.s.retraction).toFixed(3)} F${this.s.retractionSpeed * 60}`);
    this.time += this.s.retraction / this.s.retractionSpeed;
    this.retracted = true;
  }
  unretract() {
    if (!this.retracted) return;
    this.line(`G1 E${this.s.retraction.toFixed(3)} F${this.s.retractionSpeed * 60}`);
    this.time += this.s.retraction / this.s.retractionSpeed;
    this.retracted = false;
  }
  travel(x, y) {
    const d = Math.hypot(x - this.x, y - this.y);
    if (d < 0.01) return;
    if (d > 1.5) this.retract();
    this.line(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F${this.s.speedTravel * 60}`);
    this.time += d / this.s.speedTravel;
    this.x = x;
    this.y = y;
  }
  extrudeTo(x, y, speed, h) {
    this.unretract();
    const d = Math.hypot(x - this.x, y - this.y);
    if (d < 0.001) return;
    const e = (d * h * this.s.lineWidth * this.s.flow) / this.area;
    this.line(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${e.toFixed(5)} F${Math.round(speed * 60)}`);
    this.filament += e;
    this.time += d / speed;
    this.x = x;
    this.y = y;
  }
  printLoop(pts, speed, h) {
    // démarre au point le plus proche de la buse
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => {
      const d = Math.hypot(p[0] - this.x, p[1] - this.y);
      if (d < bd) { bd = d; best = i; }
    });
    const r = pts.slice(best).concat(pts.slice(0, best));
    this.travel(r[0][0], r[0][1]);
    for (let i = 1; i < r.length; i++) this.extrudeTo(r[i][0], r[i][1], speed, h);
    this.extrudeTo(r[0][0], r[0][1], speed, h);
  }
  printSegment(seg, speed, h) {
    let [a, b] = seg;
    if (Math.hypot(b[0] - this.x, b[1] - this.y) < Math.hypot(a[0] - this.x, a[1] - this.y)) [a, b] = [b, a];
    this.travel(a[0], a[1]);
    this.extrudeTo(b[0], b[1], speed, h);
  }
}

// ---------------------------------------------------------------------------
// Découpage complet
// ---------------------------------------------------------------------------

export async function slice(tri, userSettings = {}, machine = KOBRA_2_PRO, onProgress = () => {}) {
  const s = { ...DEFAULT_SETTINGS, ...userSettings };
  if (!tri || tri.length < 9) throw new Error('Aucune géométrie à découper : ajoute une extrusion.');

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < tri.length; i += 3) {
    minX = Math.min(minX, tri[i]); maxX = Math.max(maxX, tri[i]);
    minY = Math.min(minY, tri[i + 1]); maxY = Math.max(maxY, tri[i + 1]);
    minZ = Math.min(minZ, tri[i + 2]); maxZ = Math.max(maxZ, tri[i + 2]);
  }
  const size = [maxX - minX, maxY - minY, maxZ - minZ];
  if (size[0] > machine.bed.x || size[1] > machine.bed.y || size[2] > machine.bed.z) {
    throw new Error(
      `Pièce trop grande (${size.map((v) => v.toFixed(1)).join(' × ')} mm) pour le plateau ` +
        `${machine.bed.x} × ${machine.bed.y} × ${machine.bed.z} mm.`
    );
  }
  if (size[2] < 0.1) throw new Error('Pièce trop plate pour être imprimée (moins de 0,1 mm de haut).');

  // Centre la pièce sur le plateau et la pose à Z = 0
  const ox = machine.bed.x / 2 - (minX + maxX) / 2;
  const oy = machine.bed.y / 2 - (minY + maxY) / 2;
  const oz = -minZ;
  const t = new Float32Array(tri.length);
  for (let i = 0; i < tri.length; i += 3) {
    t[i] = tri[i] + ox;
    t[i + 1] = tri[i + 1] + oy;
    t[i + 2] = tri[i + 2] + oz;
  }

  // Hauteurs de couches
  const height = size[2];
  const first = Math.min(s.firstLayerHeight, height);
  let n = 1;
  let lh = s.layerHeight;
  if (height > first + 1e-6) {
    n = Math.max(2, Math.round((height - first) / lh) + 1);
    lh = (height - first) / (n - 1);
  }
  const zs = Array.from({ length: n }, (_, k) => first + k * lh);

  const w = new Writer(s, machine);
  const bx = machine.bed.x, by = machine.bed.y;
  w.line(`; Généré par ForgeCAD pour ${machine.name}`);
  w.line(`; couches=${n} hauteur=${s.layerHeight}mm remplissage=${Math.round(s.infill * 100)}% périmètres=${s.perimeters}`);
  w.line('G90 ; positions absolues');
  w.line('M83 ; extrusion relative');
  w.line(`M140 S${s.bedTemp}`);
  w.line(`M104 S${s.nozzleTemp}`);
  w.line('G28 ; origine');
  if (s.autoLevel) w.line('G29 ; nivellement automatique');
  w.line(`M190 S${s.bedTemp}`);
  w.line(`M109 S${s.nozzleTemp}`);
  w.line('; ligne de purge');
  w.line('G1 X5 Y20 Z0.3 F5000');
  w.line('G1 X5 Y200 Z0.3 E12 F1500');
  w.line('G1 Z2 F600');
  w.line(`G1 E-${s.retraction} F${s.retractionSpeed * 60}`);
  w.retracted = true;
  w.line('M107 ; ventilateur coupé');

  const lw = s.lineWidth;
  for (let i = 0; i < n; i++) {
    const zTop = zs[i];
    const h = i === 0 ? zs[0] : zs[i] - zs[i - 1];
    const loops = crossSection(t, zTop - h / 2);
    w.line(`;LAYER:${i}`);
    w.retract();
    w.line(`G0 Z${zTop.toFixed(3)} F600`);
    if (i === s.fanFromLayer - 1) w.line('M106 S255');
    if (!loops.length) {
      if (i % 5 === 0) { onProgress((i + 1) / n); await new Promise((r) => setTimeout(r, 0)); }
      continue;
    }

    // Périmètres : on les calcule du contour vers l'intérieur
    const perims = [];
    let cur = loops;
    for (let k = 0; k < s.perimeters && cur.length; k++) {
      cur = offsetLoops(cur, k === 0 ? lw / 2 : lw);
      if (cur.length) perims.push(cur);
    }
    const sp = i === 0;
    // intérieur d'abord, contour extérieur en dernier (meilleure finition)
    for (let k = perims.length - 1; k >= 0; k--) {
      for (const l of perims[k]) w.printLoop(l.pts, sp ? s.speedFirst : s.speedPerimeter, h);
    }

    // Remplissage
    const region = perims.length ? offsetLoops(perims[perims.length - 1], lw * 0.45) : [];
    if (region.length) {
      const solid = i < s.bottomLayers || i >= n - s.topLayers || s.infill >= 0.99;
      if (solid || s.infill > 0) {
        const spacing = solid ? lw : lw / s.infill;
        const angle = i % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
        const segs = infillLines(region.map((l) => l.pts), angle, spacing);
        for (const seg of segs) w.printSegment(seg, sp ? s.speedFirst : s.speedInfill, h);
      }
    }

    if (i % 5 === 0) {
      onProgress((i + 1) / n);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  w.retract();
  w.line('M104 S0');
  w.line('M140 S0');
  w.line('M107');
  w.line(`G0 Z${Math.min(height + 10, machine.bed.z).toFixed(1)} F600`);
  w.line(`G0 X10 Y${by - 10} F3000`);
  w.line('M84 ; moteurs off');
  onProgress(1);

  const timeSec = w.time * 1.3; // marge pour accélérations
  const filamentMm = w.filament;
  const filamentGrams = ((filamentMm * w.area) / 1000) * 1.24; // PLA ~1,24 g/cm³
  return {
    gcode: w.out.join('\n') + '\n',
    stats: { layers: n, timeSec, filamentMm, filamentGrams, size },
  };
}
