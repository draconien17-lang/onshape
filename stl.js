// Export STL binaire à partir d'un Float32Array de triangles (x,y,z × 3 sommets).
export function trianglesToBinarySTL(tri) {
  const n = Math.floor(tri.length / 9);
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let i = 0; i < n; i++) {
    const b = i * 9;
    const ux = tri[b + 3] - tri[b], uy = tri[b + 4] - tri[b + 1], uz = tri[b + 5] - tri[b + 2];
    const vx = tri[b + 6] - tri[b], vy = tri[b + 7] - tri[b + 1], vz = tri[b + 8] - tri[b + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (let k = 0; k < 9; k++) { dv.setFloat32(o, tri[b + k], true); o += 4; }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}
