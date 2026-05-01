/**
 * Interactive 3D gnomon (orientation cube) that mirrors the main camera.
 * Click axis balls to snap to orthographic views.
 *
 * Usage:
 *   import { createGnomon } from './src/gnomon.js';
 *   const gnomon = createGnomon(camera, controls, {
 *     target: new THREE.Vector3(0.05, 0.12, 0),
 *     views: { front: {...}, back: {...}, ... },  // optional
 *   });
 *   // In render loop:
 *   gnomon.update();
 */
import * as THREE from 'three';

const AXIS_DEFS = [
  { dir: [1, 0, 0], color: 0xc06040, label: 'X', view: 'right' },
  { dir: [0, 1, 0], color: 0xa0a060, label: 'Y', view: 'top' },
  { dir: [0, 0, 1], color: 0x4070a0, label: 'Z', view: 'front' },
];

const DEFAULT_VIEWS = {
  front:  { pos: [0, 0,  1], up: [0, 1, 0] },
  back:   { pos: [0, 0, -1], up: [0, 1, 0] },
  left:   { pos: [-1, 0, 0], up: [0, 1, 0] },
  right:  { pos: [1,  0, 0], up: [0, 1, 0] },
  top:    { pos: [0,  1, 0.001], up: [0, 0, -1] },
  bottom: { pos: [0, -1, 0.001], up: [0, 0, 1] },
};

export function createGnomon(mainCamera, controls, opts = {}) {
  const target = opts.target || controls.target.clone();
  const viewDist = opts.viewDist || 0.35;
  const size = opts.size || 120;
  const views = opts.views || null; // if null, auto-compute from target + viewDist
  const onSnap = opts.onSnap || null; // optional callback(viewName)

  // Build view presets (centered on target at viewDist)
  function getViews() {
    if (views) return views;
    const t = target;
    const d = viewDist;
    return {
      front:  { pos: [t.x, t.y, t.z + d], up: [0, 1, 0] },
      back:   { pos: [t.x, t.y, t.z - d], up: [0, 1, 0] },
      left:   { pos: [t.x - d, t.y, t.z], up: [0, 1, 0] },
      right:  { pos: [t.x + d, t.y, t.z], up: [0, 1, 0] },
      top:    { pos: [t.x, t.y + d, t.z + 0.001], up: [0, 0, -1] },
      bottom: { pos: [t.x, t.y - d, t.z + 0.001], up: [0, 0, 1] },
    };
  }

  // Create canvas + renderer
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.id = 'gnomon-canvas';
  canvas.style.cssText = `
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    z-index: 20; cursor: pointer; border-radius: 8px;
  `;
  document.body.appendChild(canvas);

  const gRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  gRenderer.setSize(size, size);
  gRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  cam.position.set(0, 0, 3.2);

  // Center sphere
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x71717a, transparent: true, opacity: 0.4 })
  ));

  const hitTargets = [];

  for (const ax of AXIS_DEFS) {
    const dir = new THREE.Vector3(...ax.dir);

    // Axis line
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), dir.clone().multiplyScalar(0.75)
    ]);
    scene.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: ax.color, linewidth: 2 })));

    // Positive ball
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshBasicMaterial({ color: ax.color })
    );
    ball.position.copy(dir).multiplyScalar(1.0);
    scene.add(ball);
    hitTargets.push({ obj: ball, view: ax.view, label: '+' + ax.label });

    // Label sprite
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 64; labelCanvas.height = 64;
    const ctx = labelCanvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ax.label, 32, 34);
    const tex = new THREE.CanvasTexture(labelCanvas);
    tex.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.position.copy(ball.position);
    sprite.scale.set(0.35, 0.35, 1);
    sprite.renderOrder = 10;
    scene.add(sprite);

    // Negative dot
    const negBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 12, 8),
      new THREE.MeshBasicMaterial({ color: ax.color, transparent: true, opacity: 0.4 })
    );
    negBall.position.copy(dir).multiplyScalar(-1.0);
    scene.add(negBall);
    const negView = { right: 'left', top: 'bottom', front: 'back' }[ax.view];
    hitTargets.push({ obj: negBall, view: negView, label: '-' + ax.label });
  }

  // Click to snap view
  const raycaster = new THREE.Raycaster();
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(mx, my), cam);
    const hits = raycaster.intersectObjects(hitTargets.map(t => t.obj));
    if (hits.length > 0) {
      const t = hitTargets.find(h => h.obj === hits[0].object);
      if (t) {
        const v = getViews()[t.view];
        if (v) {
          mainCamera.position.set(...v.pos);
          mainCamera.up.set(...v.up);
          controls.target.copy(target);
          controls.update();
          if (onSnap) onSnap(t.view);
        }
      }
    }
  });

  const _camDir = new THREE.Vector3();

  return {
    canvas,
    update() {
      mainCamera.getWorldDirection(_camDir);
      cam.position.copy(_camDir).multiplyScalar(-3.2);
      cam.up.copy(mainCamera.up);
      cam.lookAt(0, 0, 0);
      gRenderer.render(scene, cam);
    },
    dispose() {
      canvas.remove();
      gRenderer.dispose();
    },
  };
}
