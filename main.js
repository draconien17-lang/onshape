import './style.css';
import { Viewport } from './viewport.js';
import * as M from './model.js';
import { SketchEditor } from './sketchEditor.js';
import { PrintDialog } from './printDialog.js';
import { trianglesToBinarySTL } from './stl.js';

const KEY = 'forgecad.project';
const $ = (id) => document.getElementById(id);

function loadSaved() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    return M.isValidProject(p) ? p : null;
  } catch {
    return null;
  }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(project)); } catch {}
}

let project = loadSaved() || M.createDemoProject();
let selectedId = null;

const viewport = new Viewport($('viewport'));
const sketchEditor = new SketchEditor($('sketch-dialog'), () => rebuild());
const printDialog = new PrintDialog($('print-dialog'), () => M.projectTriangles(project), () => project.name);

// --- petit utilitaire DOM ---------------------------------------------------
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function safeName() {
  return (project.name || 'piece').normalize('NFD').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'piece';
}

// --- rendu ------------------------------------------------------------------
function refreshView() {
  viewport.setGeometries(M.buildAll(project), selectedId);
}
function rebuild() {
  refreshView();
  save();
}
function renderAll() {
  renderTree();
  renderProps();
  rebuild();
}

function select(id) {
  selectedId = id;
  renderTree();
  renderProps();
  refreshView();
}

function renderTree() {
  const ul = $('feature-list');
  ul.replaceChildren();
  if (!project.features.length) {
    ul.append(el('li', { class: 'empty' }, 'Aucune fonction. Crée une esquisse pour commencer.'));
    return;
  }
  for (const f of project.features) {
    const li = el(
      'li',
      { class: f.id === selectedId ? 'sel' : '' },
      el('span', { class: 'kind' }, f.type === 'sketch' ? 'Esquisse' : 'Extrusion'),
      el('span', { class: 'name' }, f.name),
      el('button', {
        class: 'del',
        title: 'Supprimer',
        'aria-label': `Supprimer ${f.name}`,
        onClick: (e) => { e.stopPropagation(); deleteFeature(f); },
      }, '✕')
    );
    li.addEventListener('click', () => select(f.id));
    li.addEventListener('dblclick', () => { if (f.type === 'sketch') sketchEditor.open(f); });
    ul.append(li);
  }
}

function renderProps() {
  const box = $('props');
  box.replaceChildren(el('h2', {}, 'Paramètres'));
  const f = M.getFeature(project, selectedId);
  if (!f) {
    box.append(el('p', { class: 'hint' }, 'Sélectionne une fonction dans l’arbre pour régler ses paramètres.'));
    return;
  }
  const name = el('input', {
    type: 'text',
    value: f.name,
    onInput: (e) => { f.name = e.target.value || 'Sans nom'; renderTree(); save(); },
  });
  box.append(el('label', {}, 'Nom', name));

  if (f.type === 'sketch') {
    const plane = el('select', { onChange: (e) => { f.plane = e.target.value; rebuild(); } });
    for (const [v, l] of [['XY', 'Plan XY (dessus)'], ['XZ', 'Plan XZ (face)'], ['YZ', 'Plan YZ (côté)']]) {
      plane.append(el('option', { value: v }, l));
    }
    plane.value = f.plane;
    box.append(el('label', {}, 'Plan', plane));
    box.append(el('p', { class: 'hint' }, `${f.shapes.length} forme(s) dans l’esquisse.`));
    box.append(el('button', { class: 'primary', onClick: () => sketchEditor.open(f) }, 'Modifier l’esquisse'));
  } else {
    const sketches = project.features.filter((x) => x.type === 'sketch');
    const sel = el('select', { onChange: (e) => { f.sketchId = e.target.value; rebuild(); } });
    for (const s of sketches) sel.append(el('option', { value: s.id }, s.name));
    sel.value = f.sketchId;
    box.append(el('label', {}, 'Esquisse à extruder', sel));
    const depth = el('input', {
      type: 'number', min: '0.1', step: '0.5', value: f.depth,
      onInput: (e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v) && v > 0) { f.depth = v; rebuild(); }
      },
    });
    box.append(el('label', {}, 'Profondeur (mm)', depth));
  }
}

function deleteFeature(f) {
  const deps = project.features.filter((x) => x.type === 'extrude' && x.sketchId === f.id);
  if (f.type === 'sketch' && deps.length && !confirm(`Supprimer aussi ${deps.length} extrusion(s) qui utilisent ${f.name} ?`)) return;
  M.removeFeature(project, f.id);
  if (!M.getFeature(project, selectedId)) selectedId = null;
  renderAll();
}

// --- actions ------------------------------------------------------------------
$('project-name').value = project.name;
$('project-name').addEventListener('input', (e) => { project.name = e.target.value; save(); });

$('btn-new-sketch').addEventListener('click', () => {
  const s = M.addSketch(project, $('plane').value);
  selectedId = s.id;
  renderAll();
  sketchEditor.open(s);
});

$('btn-new-extrude').addEventListener('click', () => {
  const current = M.getFeature(project, selectedId);
  const sketches = project.features.filter((x) => x.type === 'sketch');
  const sk = current?.type === 'sketch' ? current : sketches[sketches.length - 1];
  if (!sk) { alert('Crée d’abord une esquisse, puis extrude-la.'); return; }
  const e = M.addExtrude(project, sk.id);
  selectedId = e.id;
  renderAll();
});

$('btn-fit').addEventListener('click', () => viewport.fit());

$('btn-save').addEventListener('click', () => {
  downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${safeName()}.forgecad.json`);
});
$('btn-open').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const p = JSON.parse(await file.text());
    if (!M.isValidProject(p)) throw new Error('format inconnu');
    project = p;
    selectedId = null;
    $('project-name').value = project.name || '';
    viewport.hadModel = false;
    renderAll();
  } catch (err) {
    alert(`Impossible d’ouvrir ce fichier : ${err.message}`);
  }
});

$('btn-stl').addEventListener('click', () => {
  const tri = M.projectTriangles(project);
  if (!tri.length) { alert('Rien à exporter : ajoute une extrusion.'); return; }
  downloadBlob(new Blob([trianglesToBinarySTL(tri)], { type: 'model/stl' }), `${safeName()}.stl`);
});

$('btn-print').addEventListener('click', () => printDialog.open());

renderAll();
