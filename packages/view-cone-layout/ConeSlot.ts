/**
 * ConeSlot.ts — Declares how a scene element should be placed in the view cone.
 *
 * Attach to any SceneObject that participates in cone layout.
 * ViewConeLayout reads these to resolve conflicts.
 */

@component
export class ConeSlot extends BaseScriptComponent {

  @input @hint("Preferred sector: TOP-LEFT, TOP, TOP-RIGHT, LEFT, CENTER, RIGHT, BOT-LEFT, BOTTOM, BOT-RIGHT")
  sector: string = "CENTER";

  @input @hint("Depth lane: near (30-50cm), mid (50-80cm), far (80-120cm)")
  depthLane: string = "mid";

  @input @hint("Priority: higher stays put, lower gets pushed (0-10)")
  priority: number = 5;

  @input @hint("Element width in cm (0 = auto from RMV bounds)")
  width: number = 0;

  @input @hint("Element height in cm (0 = auto from RMV bounds)")
  height: number = 0;

  @input @hint("Minimum angular height for legibility (degrees, 0 = no constraint)")
  minAngularHeight: number = 0;

  @input @hint("Can this element be pushed to another sector?")
  pushable: boolean = true;

  @input @hint("Can this element be moved to a different depth lane?")
  depthFlexible: boolean = true;

  // Set by ViewConeLayout after resolution
  private _resolvedSector: string = "";
  private _resolvedDepthLane: string = "";

  getResolvedSector(): string { return this._resolvedSector || this.sector; }
  getResolvedDepthLane(): string { return this._resolvedDepthLane || this.depthLane; }

  _setResolved(sector: string, lane: string) {
    this._resolvedSector = sector;
    this._resolvedDepthLane = lane;
  }

  /** Auto-detect size from RenderMeshVisual if width/height are 0. */
  getSize(): vec2 {
    if (this.width > 0 && this.height > 0) return new vec2(this.width, this.height);

    var rmv = this.getSceneObject().getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    if (rmv && rmv.mesh) {
      var aabbMin = rmv.mesh.aabbMin;
      var aabbMax = rmv.mesh.aabbMax;
      var scale = this.getSceneObject().getTransform().getWorldScale();
      return new vec2(
        (aabbMax.x - aabbMin.x) * scale.x,
        (aabbMax.y - aabbMin.y) * scale.y
      );
    }

    // Fallback: check children for FlowPanel-like known sizes
    return new vec2(this.width || 20, this.height || 8);
  }
}
