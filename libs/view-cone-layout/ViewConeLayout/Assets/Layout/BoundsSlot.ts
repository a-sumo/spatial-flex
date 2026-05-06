/**
 * BoundsSlot.ts — drop-in replacement for ConeSlot when the slot's shape
 * isn't an authored width/height panel. Reads the world AABB of the first
 * BaseMeshVisual on the SceneObject and lets ViewConeLayout compute angular
 * extent from the projected bounds. Works for SIK buttons, Frames, image
 * components, custom meshes — anything with a worldAabbMin/Max.
 *
 * Same priority/pushable/depth-flexible inputs as ConeSlot, so ViewConeLayout
 * can treat both kinds of slot uniformly. The duck-typing in
 * ViewConeLayout.collectSlots looks for `sector` / `depthLane` / `priority`
 * — those are the only fields that matter for slot detection.
 */

@component
export class BoundsSlot extends BaseScriptComponent {

  @input @hint('Preferred sector hint (informational only).')
  sector: string = 'CENTER';

  @input @hint('Depth lane hint: near, mid, far.')
  depthLane: string = 'mid';

  @input @hint('Higher priority stays put; lower gets pushed (0-10).')
  priority: number = 5;

  @input @hint('Allow depth-push to resolve overlaps.')
  pushable: boolean = true;

  @input @hint('Allow this slot to switch depth lanes.')
  depthFlexible: boolean = true;

  @input @hint('Minimum angular height for legibility (deg). 0 = no constraint.')
  minAngularHeight: number = 0;

  // Set by ViewConeLayout post-resolution.
  private _resolvedSector: string = '';
  private _resolvedDepthLane: string = '';

  getResolvedSector(): string { return this._resolvedSector || this.sector; }
  getResolvedDepthLane(): string { return this._resolvedDepthLane || this.depthLane; }

  _setResolved(sector: string, lane: string) {
    this._resolvedSector = sector;
    this._resolvedDepthLane = lane;
  }

  /**
   * Returns world AABB extent on the camera-facing plane. Used as a coarse
   * "size" by ViewConeLayout when it needs an angular size scale; the
   * resolver itself reads the angular rect via projectObjectAabb instead.
   */
  getSize(): vec2 {
    var visual = this.getSceneObject().getComponent('Component.BaseMeshVisual') as any;
    if (!visual || typeof visual.worldAabbMin !== 'function') {
      return new vec2(8, 8);
    }
    var aMin = visual.worldAabbMin();
    var aMax = visual.worldAabbMax();
    if (!aMin || !aMax) return new vec2(8, 8);
    return new vec2(aMax.x - aMin.x, aMax.y - aMin.y);
  }
}
