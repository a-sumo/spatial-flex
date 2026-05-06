/**
 * TextAutoFit — predicts the on-display pixel height of every Text under
 * `root` and rescales `text.size` so that height equals `targetPx`.
 *
 * Uses LS's BaseMeshVisual world AABB instead of font-metric guesswork:
 * a Text component knows its own rendered bounds in world space, including
 * every ancestor scale. From there:
 *
 *   distance      = ‖ aabbCenter − camPos ‖             (cm)
 *   heightWorld   = aabbMax.y − aabbMin.y               (cm)
 *   angularDeg    = 2 · atan(heightWorld / 2 / distance)
 *   currentPx     = angularDeg · ppd                    (display pixels)
 *   newSize       = currentSize · (targetPx / currentPx)
 *
 * The size↔world-height relationship is approximately linear, so one pass
 * gets close and 2 passes converges within 1%. Wrap/Shrink overflow modes
 * (TextShrinkwrap.ts) interact with size — if Shrink kicks in, the
 * effective rendered cap height stops scaling with size; cap `passes` at 3.
 */

import { registerRemoteTrigger, unregisterRemoteTrigger } from '../Streaming/RemoteTriggers';

@component
export class TextAutoFit extends BaseScriptComponent {

  @input
  @allowUndefined
  @hint('Walk this object\'s descendants. Empty = self.')
  public root: SceneObject;

  @input
  @hint('Camera SceneObject. Required for distance computation.')
  public cameraObj: SceneObject;

  @input
  @hint('Display pixels per degree (PPD). Spectacles per-eye ≈ 44.7 (calibrated).')
  public ppd: number = 44.7;

  @input
  @hint('Target on-display pixel height for text glyphs. 24 = readability default for AR.')
  public targetPx: number = 24;

  @input
  @hint('Empirical world-cm cap-height per text.size unit (k). text.worldSpaceRect is the LAYOUT BOX, not rendered glyphs — so we predict cap height as text.size × k. Calibrate once: render at size=100, measure cm, k = capH/100. Default 0.07 ≈ typical LS font.')
  public calibrationFactor: number = 0.07;

  @input
  @widget(new SliderWidget(1, 5, 1))
  @hint('Correction passes. Linear math converges in 1; non-linear shrink overflow benefits from 2-3.')
  public passes: number = 2;

  @input
  @hint('Re-fit on every UpdateEvent. Off: only on start + the text-autofit remote trigger.')
  public continuous: boolean = false;

  @input
  public verbose: boolean = false;

  onAwake() {
    this.createEvent('OnStartEvent').bind(() => this.applyAll());
    this.createEvent('UpdateEvent').bind(() => {
      if (this.continuous) this.applyAll();
    });
    this.createEvent('OnDestroyEvent').bind(() =>
      unregisterRemoteTrigger('text-autofit')
    );
    registerRemoteTrigger('text-autofit', () => this.applyAll());
  }

  /**
   * One-shot fit pass over every Text in the tree. Public so other scripts
   * (or the remote trigger) can fire it on demand.
   */
  public applyAll() {
    if (!this.cameraObj) return;
    const camPos = this.cameraObj.getTransform().getWorldPosition();
    const root = this.root || this.getSceneObject();
    let n = 0;
    this.walk(root, (obj) => {
      const text = obj.getComponent('Component.Text') as Text;
      if (!text) return;
      for (let p = 0; p < this.passes; p++) {
        if (!this.fitOnce(text, camPos)) break;
      }
      n++;
    });
    if (this.verbose) {
      print('[TextAutoFit] fitted ' + n + ' Text(s) → ' + this.targetPx + 'px @ ppd=' + this.ppd);
    }
  }

  /**
   * Compute the on-display pixel cap height for a single Text, given the
   * camera position. Pure read; no mutation. Useful from agent code that
   * wants to know "is this readable right now?" without changing it.
   *
   * Uses Text.worldSpaceRect (not BaseMeshVisual.worldAabbMin/Max — Text
   * doesn't actually expose mesh bounds). worldSpaceRect.top/bottom give
   * the rendered text's world-space height directly.
   */
  public measurePixelHeight(text: Text, camPos: vec3): number {
    const rect: any = (text as any).worldSpaceRect;
    if (!rect) return 0;
    const heightWorld = rect.top - rect.bottom;
    // Centre = midpoint of text rect, plus the SceneObject's world position
    // along Z (worldSpaceRect is XY-only). Distance is dominated by Z.
    const wp = text.getSceneObject().getTransform().getWorldPosition();
    const cx = (rect.left + rect.right) * 0.5;
    const cy = (rect.bottom + rect.top) * 0.5;
    const cz = wp.z;
    const dx = cx - camPos.x, dy = cy - camPos.y, dz = cz - camPos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance <= 0 || heightWorld <= 0) return 0;
    const angularDeg = 2 * Math.atan(heightWorld / 2 / distance) * 180 / Math.PI;
    return angularDeg * this.ppd;
  }

  /** Returns true if size was changed (i.e. another pass might improve). */
  private fitOnce(text: Text, camPos: vec3): boolean {
    const beforeSize = text.size;

    // Empirical path — primary mode. text.worldSpaceRect is the LAYOUT
    // BOX, not rendered glyph bounds, so reading it overestimates capH
    // and drives text.size to LS's clamp (≈2). Empirical is the only
    // approach with no internal LS API: text.size × k = world cap height,
    // so target_size = (target_capH_world / k). One-pass closed-form.
    if (this.calibrationFactor > 0) {
      const wp = text.getSceneObject().getTransform().getWorldPosition();
      const dx = wp.x - camPos.x, dy = wp.y - camPos.y, dz = wp.z - camPos.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance <= 0) return false;
      const targetAngularDeg = this.targetPx / this.ppd;
      const targetCapHWorld = 2 * distance * Math.tan(targetAngularDeg * 0.5 * Math.PI / 180);
      const newSize = Math.max(1, targetCapHWorld / this.calibrationFactor);
      if (Math.abs(newSize - beforeSize) < 0.5) return false;
      text.size = newSize;
      if (this.verbose) {
        // Predicted on-display pixel cap height at the new size — this is
        // the value to compare against measured render to refine k.
        const predictedCapH = newSize * this.calibrationFactor;
        const predictedDeg = 2 * Math.atan(predictedCapH * 0.5 / distance) * 180 / Math.PI;
        const predictedPx = predictedDeg * this.ppd;
        print('[TextAutoFit]   ' + text.getSceneObject().name +
          ' (k=' + this.calibrationFactor + '): dist=' + distance.toFixed(0) +
          'cm size ' + beforeSize + ' → ' + newSize.toFixed(1) +
          ' (readback=' + text.size + ', predicts ' + predictedPx.toFixed(0) + 'px)');
      }
      return true;
    }

    // Bounds path — disabled by default since worldSpaceRect is the
    // layout box, not rendered glyphs. Kept for the case where you've
    // verified Text exposes rendered bounds via a different property.
    const currentPx = this.measurePixelHeight(text, camPos);
    if (!(currentPx > 0)) {
      if (this.verbose) {
        const rect: any = (text as any).worldSpaceRect;
        const h = rect ? (rect.top - rect.bottom) : 0;
        print('[TextAutoFit]   ' + text.getSceneObject().name +
          ': SKIP currentPx=' + currentPx.toFixed(2) +
          ' heightWorld=' + h.toFixed(2) + ' size=' + beforeSize +
          (!(text as any).font ? ' (no font; set calibrationFactor)' : ''));
      }
      return false;
    }
    const ratio = this.targetPx / currentPx;
    if (Math.abs(ratio - 1) < 0.01) {
      if (this.verbose) {
        print('[TextAutoFit]   ' + text.getSceneObject().name +
          ': OK currentPx=' + currentPx.toFixed(1) + ' (within 1% of ' + this.targetPx + ')');
      }
      return false;
    }
    const newSize = Math.max(1, beforeSize * ratio);
    text.size = newSize;
    if (this.verbose) {
      print('[TextAutoFit]   ' + text.getSceneObject().name +
        ': currentPx=' + currentPx.toFixed(1) + ' ratio=' + ratio.toFixed(3) +
        ' size ' + beforeSize + ' → ' + newSize.toFixed(1) +
        ' (readback=' + text.size + ')');
    }
    return true;
  }

  private walk(obj: SceneObject, visit: (o: SceneObject) => void) {
    visit(obj);
    const c = obj.getChildrenCount();
    for (let i = 0; i < c; i++) this.walk(obj.getChild(i), visit);
  }
}
