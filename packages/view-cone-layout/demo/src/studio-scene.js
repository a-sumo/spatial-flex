/**
 * Studio scene setup shared across all SO-101 tools.
 * Returns { scene, camera, renderer, controls, grid, floor, envMap, setBackground }.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const DEFAULTS = {
  target: [0.05, 0.12, 0],
  cameraPos: [0.28, 0.28, 0.42],
  fov: 40,
  background: '#e8e4e0',
  shadows: true,
  gridVisible: false,
  maxPolarAngle: Math.PI * 0.52,
  container: null, // defaults to document.body
};

export function createStudioScene(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const container = o.container || document.body;

  // ─── Scene ───
  const scene = new THREE.Scene();
  let bgColor = new THREE.Color(o.background);
  scene.background = bgColor;

  // ─── Camera ───
  const camera = new THREE.PerspectiveCamera(o.fov, innerWidth / innerHeight, 0.001, 20);
  camera.position.set(...o.cameraPos);

  // ─── Renderer ───
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  if (o.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // ─── Studio environment (HDRI-like IBL from RoomEnvironment) ───
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  const roomEnv = new RoomEnvironment(renderer);
  const envMap = pmremGenerator.fromScene(roomEnv, 0.04).texture;
  scene.environment = envMap;
  roomEnv.dispose();

  // ─── Smooth camera controls ───
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...o.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = o.maxPolarAngle;
  controls.minDistance = 0.08;
  controls.maxDistance = 1.5;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.8;

  // ─── Studio lighting ───
  // Key light — warm, soft shadow
  const keyLight = new THREE.DirectionalLight(0xfff8f0, 1.8);
  keyLight.position.set(0.4, 0.8, 0.5);
  if (o.shadows) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -0.4;
    keyLight.shadow.camera.right = 0.4;
    keyLight.shadow.camera.top = 0.4;
    keyLight.shadow.camera.bottom = -0.1;
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 2;
    keyLight.shadow.bias = -0.001;
    keyLight.shadow.radius = 4;
    keyLight.shadow.blurSamples = 16;
  }
  scene.add(keyLight);

  // Fill light — cool, no shadow
  const fillLight = new THREE.DirectionalLight(0xe8f0ff, 0.6);
  fillLight.position.set(-0.5, 0.5, -0.3);
  scene.add(fillLight);

  // Rim light — subtle back kick
  const rimLight = new THREE.DirectionalLight(0xfff0e0, 0.4);
  rimLight.position.set(0.0, 0.3, -0.6);
  scene.add(rimLight);

  // Soft hemisphere fill
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xb0a090, 0.3);
  scene.add(hemiLight);

  // ─── Floor plane with shadow ───
  const floorGeo = new THREE.PlaneGeometry(2, 2);
  const floorMat = new THREE.ShadowMaterial({ opacity: 0.15, color: 0x000000 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.002;
  floor.receiveShadow = true;
  scene.add(floor);

  // ─── Grid (hidden by default for studio look) ───
  const grid = new THREE.GridHelper(0.5, 20, 0xc8c4c0, 0xd8d4d0);
  grid.material.opacity = 0.3;
  grid.material.transparent = true;
  grid.visible = o.gridVisible;
  scene.add(grid);

  // ─── Background setter ───
  function setBackground(hex) {
    bgColor = new THREE.Color(hex);
    scene.background = bgColor;
    const lum = bgColor.r * 0.299 + bgColor.g * 0.587 + bgColor.b * 0.114;
    const isDark = lum < 0.3;
    grid.material.color.setHex(isDark ? 0x27272a : 0xc8c4c0);
    grid.material.opacity = isDark ? 0.5 : 0.3;
    floor.material.opacity = isDark ? 0.3 : 0.15;
    // Update UI swatches if present
    document.querySelectorAll('.bg-swatch').forEach(s => s.classList.remove('active'));
  }

  // Apply initial background adaptation
  setBackground(o.background);

  // ─── Resize handler ───
  const onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  };
  window.addEventListener('resize', onResize);

  return { scene, camera, renderer, controls, grid, floor, envMap, setBackground, onResize };
}

/**
 * Apply studio-quality URDF materials (servo vs printed plastic).
 * Call after loading and adding robot to scene.
 */
export function applyURDFMaterials(robot) {
  robot.traverse(c => {
    if (!c.isMesh) return;
    // Walk up to find if this is a servo mesh
    let isServo = false;
    let node = c;
    while (node) {
      if (node.name && node.name.includes('sts3215')) { isServo = true; break; }
      node = node.parent;
    }
    // Also check userData.filename from loader
    if (c.userData.filename && c.userData.filename.includes('sts3215')) isServo = true;

    c.material = new THREE.MeshStandardMaterial({
      color: isServo ? 0x3a3a42 : 0xe8e0d4,
      roughness: isServo ? 0.25 : 0.55,
      metalness: isServo ? 0.6 : 0.0,
      side: THREE.DoubleSide,
      envMapIntensity: isServo ? 1.0 : 0.6,
    });
    c.castShadow = true;
    c.receiveShadow = true;
    c.userData._origMaterial = c.material.clone();
  });
}
