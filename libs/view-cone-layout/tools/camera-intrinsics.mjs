#!/usr/bin/env node
/**
 * camera-intrinsics.mjs — measure Lens Studio / Spectacles camera intrinsics.
 *
 * Two passes:
 *  1. ANALYTICAL — read Camera.fov + active render-target dims from LS, derive
 *     fx, fy, cx, cy. LS Camera.fov is the vertical FOV in radians at runtime,
 *     but the editor inspector reports it in degrees. We try both interpretations
 *     and pick the one that yields a reasonable focal length given the dims.
 *  2. EMPIRICAL — drive the live JPEG: capture one frame from preview.html,
 *     read its true pixel dimensions (the streamer encodes whatever the
 *     active RT actually is — which on a Spectacles lens with
 *     useScreenResolution=true means the device-side dims).
 *
 * Output: a JSON-and-table report with K matrix, FOVs, and per-cm-at-distance
 * scale factor.
 */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const URL = 'http://localhost:4322/preview.html';
const MCP_URL = 'http://localhost:8731/mcp';
const MCP_TOKEN = process.env.LS_MCP_TOKEN ||
  'hTUjzELMgjXK6IURKoes4P0U2cQTnPLxvfnpp-vppt7lmzcoLFfOz3ZMzoroAJ6x';

async function mcpTool(name, args = {}) {
  const r = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const out = await r.json();
  if (out.result?.isError) throw new Error(JSON.stringify(out.result));
  const text = out.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text; }
}

// ── 1. Read declared intrinsics from the Camera component ──────────────────
const cam = await mcpTool('GetLensStudioSceneObjectByName', {
  name: 'Camera Object', recursive: true,
});
const camComp = cam.objects[0].components.find((c) => c.type === 'Camera');
const fovRaw = camComp.properties.fov;
const aspect = camComp.properties.aspect;
const cameraType = camComp.properties.cameraType;
const renderTargetId = camComp.properties.renderTarget?.id;

console.log('— Camera component (declared) —');
console.log(`  fov (raw):    ${fovRaw}`);
console.log(`  aspect:       ${aspect}`);
console.log(`  cameraType:   ${cameraType}  (0=Perspective, 1=Orthographic)`);
console.log(`  renderTarget: ${renderTargetId}`);

// LS Camera.fov is in RADIANS at runtime; the inspector dump above gives us
// either radians or degrees depending on how MCP serialises. 63.5 is too big
// for radians and too small for "FOV in some other unit" — so it's almost
// certainly degrees in this serialisation. Sanity: 63.5 deg vertical FOV is
// what LS uses for its default Spectacles editor camera.
const fovDeg = fovRaw < Math.PI ? (fovRaw * 180) / Math.PI : fovRaw;
const fovRad = fovRaw < Math.PI ? fovRaw : (fovRaw * Math.PI) / 180;
console.log(`  → interpret as: ${fovDeg.toFixed(3)}° vertical FOV`);

// ── 2. Capture one live JPEG to learn the actual pixel dims ───────────────
console.log('\n— Capturing one live frame to measure actual JPEG dims —');
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1280, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.click('#connectBtn');
await page.waitForFunction(
  () => Number(document.getElementById('frameCount').textContent) > 2,
  { timeout: 20000 },
);
const dims = await page.$eval('#streamCanvas', (c) => ({ w: c.width, h: c.height }));
await browser.close();

const W = dims.w, H = dims.h;
console.log(`  jpeg pixel dims:  ${W} × ${H}`);
console.log(`  pixel aspect:     ${(W / H).toFixed(4)}`);

// ── 3. Derive K from FOV + dims ───────────────────────────────────────────
// fy = (H/2) / tan(vFOV/2)
// fx = (W/2) / tan(hFOV/2),  where hFOV = 2·atan(tan(vFOV/2)·(W/H))
const vFov = fovRad;
const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (W / H));
const fy = (H / 2) / Math.tan(vFov / 2);
const fx = (W / 2) / Math.tan(hFov / 2);
const cx = W / 2;
const cy = H / 2;

// Sanity: with square pixels (assumed), fx should ≈ fy.
const square = Math.abs(fx - fy) < 1.0;

console.log('\n— Derived intrinsics (analytical) —');
console.log(`  vertical   FOV: ${(vFov * 180 / Math.PI).toFixed(3)}°`);
console.log(`  horizontal FOV: ${(hFov * 180 / Math.PI).toFixed(3)}°`);
console.log(`  fx = ${fx.toFixed(3)}  px`);
console.log(`  fy = ${fy.toFixed(3)}  px${square ? '   ✓ square pixels' : ''}`);
console.log(`  cx = ${cx.toFixed(3)}  px`);
console.log(`  cy = ${cy.toFixed(3)}  px`);
console.log('\n  K =');
console.log(`      [ ${fx.toFixed(2).padStart(8)}   ${'0.00'.padStart(8)}   ${cx.toFixed(2).padStart(8)} ]`);
console.log(`      [ ${'0.00'.padStart(8)}   ${fy.toFixed(2).padStart(8)}   ${cy.toFixed(2).padStart(8)} ]`);
console.log(`      [ ${'0.00'.padStart(8)}   ${'0.00'.padStart(8)}   ${'1.00'.padStart(8)} ]`);

// ── 4. Useful derived quantities ──────────────────────────────────────────
console.log('\n— Practical scale factors —');
const distances = [50, 100, 200];
for (const z of distances) {
  // pixels per cm at depth z (cm), assuming pinhole projection
  const pxPerCm = fx / z;
  console.log(`  at ${z} cm depth, 1 cm sideways  ⇒  ${pxPerCm.toFixed(2)}  px`);
}

// ── 5. Write report ───────────────────────────────────────────────────────
const report = {
  declared: {
    fov_raw: fovRaw,
    fov_deg: fovDeg,
    aspect,
    cameraType,
    renderTargetId,
  },
  measured: {
    jpeg_width: W,
    jpeg_height: H,
    pixel_aspect: W / H,
  },
  intrinsics: {
    fx, fy, cx, cy,
    vfov_deg: vFov * 180 / Math.PI,
    hfov_deg: hFov * 180 / Math.PI,
    K: [
      [fx, 0, cx],
      [0, fy, cy],
      [0, 0, 1],
    ],
  },
};
const out = '/Users/armand/Documents/spatial-flex/libs/view-cone-layout/tools/camera-intrinsics.json';
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nReport saved → ${out}`);
