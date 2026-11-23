import { slice, DEFAULT_SETTINGS, KOBRA_2_PRO } from './slicer.js';

const URL_KEY = 'forgecad.moonrakerUrl';

function formatTime(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

export class PrintDialog {
  constructor(dialog, getTriangles, getName) {
    this.dialog = dialog;
    this.getTriangles = getTriangles;
    this.getName = getName;
    this.result = null;
    this.running = false;
    const d = DEFAULT_SETTINGS;
    dialog.innerHTML = `
      <form method="dialog" class="dlg-head">
        <h3>Imprimer sur ${KOBRA_2_PRO.name}</h3>
        <button>Fermer</button>
      </form>
      <div class="print-body">
        <div class="settings">
          <label>Hauteur de couche
            <select data-s="layerHeight">
              <option value="0.12">0,12 mm (fin)</option>
              <option value="0.16">0,16 mm</option>
              <option value="0.2" selected>0,20 mm (standard)</option>
              <option value="0.28">0,28 mm (rapide)</option>
            </select>
          </label>
          <label>Remplissage (%)<input type="number" data-s="infill" min="0" max="100" step="5" value="${d.infill * 100}"></label>
          <label>Périmètres<input type="number" data-s="perimeters" min="1" max="6" step="1" value="${d.perimeters}"></label>
          <label>Buse (°C)<input type="number" data-s="nozzleTemp" min="150" max="260" step="5" value="${d.nozzleTemp}"></label>
          <label>Plateau (°C)<input type="number" data-s="bedTemp" min="0" max="110" step="5" value="${d.bedTemp}"></label>
          <label class="chk"><input type="checkbox" data-s="autoLevel" checked> Nivellement auto (G29)</label>
        </div>
        <button type="button" data-role="reslice">Redécouper</button>
        <progress data-role="progress" max="100" value="0"></progress>
        <p data-role="status" class="status"></p>
        <div class="send">
          <button type="button" class="primary" data-role="download" disabled>Télécharger le G-code</button>
          <label>Adresse Moonraker (optionnel)
            <input type="url" data-role="url" placeholder="http://192.168.1.50:7125">
          </label>
          <button type="button" data-role="send" disabled>Envoyer et lancer l'impression</button>
          <p class="hint">L'envoi direct demande une imprimante sous Klipper avec Moonraker. Sinon, télécharge le G-code et copie-le sur la carte SD.</p>
        </div>
      </div>`;
    this.progress = dialog.querySelector('[data-role="progress"]');
    this.status = dialog.querySelector('[data-role="status"]');
    this.btnDownload = dialog.querySelector('[data-role="download"]');
    this.btnSend = dialog.querySelector('[data-role="send"]');
    this.btnReslice = dialog.querySelector('[data-role="reslice"]');
    this.url = dialog.querySelector('[data-role="url"]');
    try { this.url.value = localStorage.getItem(URL_KEY) || ''; } catch {}

    this.btnReslice.addEventListener('click', () => this.run());
    this.btnDownload.addEventListener('click', () => this.download());
    this.btnSend.addEventListener('click', () => this.send());
    this.url.addEventListener('input', () => {
      try { localStorage.setItem(URL_KEY, this.url.value.trim()); } catch {}
      this.updateButtons();
    });
  }

  async open() {
    this.dialog.showModal();
    await this.run(); // découpe automatique à l'ouverture
  }

  readSettings() {
    const out = {};
    this.dialog.querySelectorAll('[data-s]').forEach((el) => {
      const k = el.dataset.s;
      if (el.type === 'checkbox') out[k] = el.checked;
      else out[k] = parseFloat(el.value);
    });
    if (Number.isFinite(out.infill)) out.infill = Math.min(1, Math.max(0, out.infill / 100));
    for (const k of Object.keys(out)) if (typeof out[k] === 'number' && !Number.isFinite(out[k])) delete out[k];
    return out;
  }

  updateButtons() {
    this.btnDownload.disabled = !this.result || this.running;
    this.btnSend.disabled = !this.result || this.running || !this.url.value.trim();
    this.btnReslice.disabled = this.running;
  }

  async run() {
    if (this.running) return;
    this.running = true;
    this.result = null;
    this.progress.value = 0;
    this.status.className = 'status';
    this.status.textContent = 'Découpage en cours…';
    this.updateButtons();
    try {
      const tri = this.getTriangles();
      this.result = await slice(tri, this.readSettings(), KOBRA_2_PRO, (p) => (this.progress.value = p * 100));
      const st = this.result.stats;
      this.status.textContent =
        `${st.layers} couches · ${formatTime(st.timeSec)} · ${(st.filamentMm / 1000).toFixed(2)} m de filament ` +
        `(≈ ${st.filamentGrams.toFixed(1)} g) · pièce ${st.size.map((v) => v.toFixed(1)).join(' × ')} mm`;
    } catch (err) {
      this.status.className = 'status error';
      this.status.textContent = err.message;
    } finally {
      this.running = false;
      this.updateButtons();
    }
  }

  fileName() {
    const base = (this.getName() || 'piece').normalize('NFD').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'piece';
    return `${base}.gcode`;
  }

  download() {
    if (!this.result) return;
    const blob = new Blob([this.result.gcode], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async send() {
    if (!this.result) return;
    const base = this.url.value.trim().replace(/\/+$/, '');
    if (!confirm("Lancer l'impression maintenant ? Vérifie que le plateau est dégagé.")) return;
    this.status.className = 'status';
    this.status.textContent = "Envoi à l'imprimante…";
    try {
      const fd = new FormData();
      fd.append('file', new Blob([this.result.gcode], { type: 'text/plain' }), this.fileName());
      fd.append('print', 'true');
      const r = await fetch(`${base}/server/files/upload`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(`réponse ${r.status}`);
      this.status.textContent = 'Fichier envoyé, impression lancée.';
    } catch (err) {
      this.status.className = 'status error';
      this.status.textContent =
        `Envoi impossible (${err.message}). Vérifie l'adresse, et que Moonraker autorise ce site dans « cors_domains ».`;
    }
  }
}
