// Éditeur d'esquisse 2D : dessin à la souris (grille 1 mm) + cotes modifiables au clavier.

const PLANE_LABELS = { XY: 'plan XY (dessus)', XZ: 'plan XZ (face)', YZ: 'plan YZ (côté)' };

export class SketchEditor {
  constructor(dialog, onChange) {
    this.dialog = dialog;
    this.onChange = onChange;
    this.sketch = null;
    this.tool = 'rect';
    this.hole = false;
    this.scale = 6; // pixels par mm
    this.drag = null;
    this.selected = -1;

    dialog.innerHTML = `
      <form method="dialog" class="dlg-head">
        <h3 data-role="title">Esquisse</h3>
        <button class="primary">Terminer l'esquisse</button>
      </form>
      <div class="sk-body">
        <div class="sk-left">
          <div class="sk-tools">
            <button type="button" data-tool="rect" class="active">Rectangle</button>
            <button type="button" data-tool="circle">Cercle</button>
            <label class="chk"><input type="checkbox" data-role="hole"> Dessiner un trou</label>
          </div>
          <canvas width="640" height="460"></canvas>
          <p class="hint">Glisse pour dessiner. La molette zoome. Les cotes se règlent à droite.</p>
        </div>
        <div class="sk-right">
          <h4>Formes</h4>
          <div data-role="list" class="shape-list"></div>
        </div>
      </div>`;
    this.canvas = dialog.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.list = dialog.querySelector('[data-role="list"]');
    this.title = dialog.querySelector('[data-role="title"]');

    dialog.querySelectorAll('[data-tool]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tool = b.dataset.tool;
        dialog.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('active', x === b));
      })
    );
    dialog.querySelector('[data-role="hole"]').addEventListener('change', (e) => (this.hole = e.target.checked));

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      const p = this.toWorld(e);
      this.drag = { a: p, b: p };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.drag.b = this.toWorld(e);
      this.draw();
    });
    c.addEventListener('pointerup', () => this.commitDrag());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.scale = Math.min(40, Math.max(1.5, this.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        this.draw();
      },
      { passive: false }
    );
    dialog.addEventListener('close', () => (this.drag = null));
  }

  open(sketch) {
    this.sketch = sketch;
    this.selected = -1;
    this.title.textContent = `${sketch.name} — ${PLANE_LABELS[sketch.plane] || sketch.plane}`;
    this.renderList();
    this.dialog.showModal();
    this.draw();
  }

  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) * this.canvas.width) / r.width;
    const py = ((e.clientY - r.top) * this.canvas.height) / r.height;
    return [Math.round((px - this.canvas.width / 2) / this.scale), Math.round(-(py - this.canvas.height / 2) / this.scale)];
  }

  commitDrag() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const [x0, y0] = d.a, [x1, y1] = d.b;
    let shape = null;
    if (this.tool === 'rect') {
      if (Math.abs(x1 - x0) >= 1 && Math.abs(y1 - y0) >= 1) {
        shape = { type: 'rect', x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), hole: this.hole };
      }
    } else {
      const r = Math.hypot(x1 - x0, y1 - y0);
      if (r >= 1) shape = { type: 'circle', cx: x0, cy: y0, r: Math.round(r * 2) / 2, hole: this.hole };
    }
    if (shape) {
      this.sketch.shapes.push(shape);
      this.selected = this.sketch.shapes.length - 1;
      this.renderList();
      this.onChange();
    }
    this.draw();
  }

  renderList() {
    this.list.innerHTML = '';
    if (!this.sketch.shapes.length) {
      this.list.innerHTML = '<p class="hint">Aucune forme. Dessine un rectangle ou un cercle sur la grille.</p>';
      return;
    }
    this.sketch.shapes.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'shape-row' + (i === this.selected ? ' sel' : '');
      const fields =
        s.type === 'rect'
          ? [['x', 'X'], ['y', 'Y'], ['w', 'Larg.'], ['h', 'Haut.']]
          : [['cx', 'X'], ['cy', 'Y'], ['r', 'Rayon']];
      row.innerHTML =
        `<strong>${s.type === 'rect' ? 'Rectangle' : 'Cercle'}</strong>` +
        fields.map(([k, l]) => `<label>${l}<input type="number" step="0.5" data-k="${k}" value="${s[k]}"></label>`).join('') +
        `<label class="chk"><input type="checkbox" data-hole ${s.hole ? 'checked' : ''}> Trou</label>` +
        `<button type="button" class="del" title="Supprimer la forme">Supprimer</button>`;
      row.addEventListener('click', () => {
        this.selected = i;
        this.list.querySelectorAll('.shape-row').forEach((r, j) => r.classList.toggle('sel', j === i));
        this.draw();
      });
      row.querySelectorAll('input[data-k]').forEach((inp) =>
        inp.addEventListener('input', () => {
          const v = parseFloat(inp.value);
          if (!Number.isFinite(v)) return;
          if (['w', 'h', 'r'].includes(inp.dataset.k) && v <= 0) return;
          s[inp.dataset.k] = v;
          this.draw();
          this.onChange();
        })
      );
      row.querySelector('[data-hole]').addEventListener('change', (e) => {
        s.hole = e.target.checked;
        this.draw();
        this.onChange();
      });
      row.querySelector('.del').addEventListener('click', (e) => {
        e.stopPropagation();
        this.sketch.shapes.splice(i, 1);
        this.selected = -1;
        this.renderList();
        this.draw();
        this.onChange();
      });
      this.list.appendChild(row);
    });
  }

  tracePath(ctx, s) {
    const W = this.canvas.width, H = this.canvas.height, k = this.scale;
    const X = (x) => W / 2 + x * k, Y = (y) => H / 2 - y * k;
    ctx.beginPath();
    if (s.type === 'rect') ctx.rect(X(s.x), Y(s.y + s.h), s.w * k, s.h * k);
    else ctx.arc(X(s.cx), Y(s.cy), s.r * k, 0, Math.PI * 2);
  }

  draw() {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, k = this.scale;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fbfbf8';
    ctx.fillRect(0, 0, W, H);

    const xmax = W / 2 / k, ymax = H / 2 / k;
    const step = k >= 12 ? 5 : 10;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#dfe2dc';
    ctx.beginPath();
    for (let gx = -Math.floor(xmax / step) * step; gx <= xmax; gx += step) {
      ctx.moveTo(W / 2 + gx * k, 0); ctx.lineTo(W / 2 + gx * k, H);
    }
    for (let gy = -Math.floor(ymax / step) * step; gy <= ymax; gy += step) {
      ctx.moveTo(0, H / 2 - gy * k); ctx.lineTo(W, H / 2 - gy * k);
    }
    ctx.stroke();
    ctx.strokeStyle = '#98a19a';
    ctx.beginPath();
    ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
    ctx.stroke();

    this.sketch?.shapes.forEach((s, i) => {
      this.tracePath(ctx, s);
      if (!s.hole) {
        ctx.fillStyle = 'rgba(115,148,184,0.35)';
        ctx.fill();
        ctx.setLineDash([]);
      } else {
        ctx.setLineDash([6, 4]);
      }
      ctx.lineWidth = i === this.selected ? 3 : 2;
      ctx.strokeStyle = i === this.selected ? '#0b7a75' : s.hole ? '#a8452f' : '#2b4a6b';
      ctx.stroke();
      ctx.setLineDash([]);
    });

    if (this.drag) {
      const [x0, y0] = this.drag.a, [x1, y1] = this.drag.b;
      const prev =
        this.tool === 'rect'
          ? { type: 'rect', x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
          : { type: 'circle', cx: x0, cy: y0, r: Math.hypot(x1 - x0, y1 - y0) };
      this.tracePath(ctx, prev);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#0b7a75';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#0b7a75';
      ctx.font = '13px system-ui, sans-serif';
      const label = this.tool === 'rect' ? `${prev.w} × ${prev.h} mm` : `rayon ${prev.r.toFixed(1)} mm`;
      ctx.fillText(label, 12, H - 14);
    }
  }
}
