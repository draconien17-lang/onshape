import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Vue 3D. Le repère est celui de la CAO : Z vers le haut.
export class Viewport {
  constructor(el) {
    this.el = el;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(110, -150, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 5);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a93a0, 1.1);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(80, -120, 200);
    this.scene.add(sun);

    const grid = new THREE.GridHelper(300, 30, 0x7b8794, 0xb4bcc6);
    grid.rotation.x = Math.PI / 2;
    this.scene.add(grid);
    this.scene.add(new THREE.AxesHelper(30));

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.hadModel = false;

    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  resize() {
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }
  }

  setGeometries(list, selectedId = null) {
    this.clear();
    for (const { id, geometry } of list) {
      const selected = id === selectedId;
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: selected ? 0x2f9e8f : 0x7394b8,
          roughness: 0.55,
          metalness: 0.1,
          side: THREE.DoubleSide,
        })
      );
      this.group.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 30),
        new THREE.LineBasicMaterial({ color: 0x25303b })
      );
      this.group.add(edges);
    }
    if (list.length && !this.hadModel) this.fit();
    this.hadModel = list.length > 0;
  }

  fit() {
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 50;
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(new THREE.Vector3(0.8, -1.1, 0.8).multiplyScalar(size * 1.3));
  }
}
