/**
 * ViewConeLayout.ts — Frustum-based spatial layout with overlap resolution.
 *
 * Projects all ConeSlot children into angular space, detects overlaps,
 * and pushes elements apart by exact overlap amount. Supports both
 * lateral (azimuth/elevation) and depth pushing.
 */

import { ConeProjector, AngularRect } from './ConeProjector';
import { ConeSlot } from './ConeSlot';
import { registerRemoteTrigger, unregisterRemoteTrigger } from '../Streaming/RemoteTriggers';

interface SlotEntry {
  slot: ConeSlot;
  obj: SceneObject;
  rect: AngularRect | null;
  targetPos: vec3;
  authoredPos: vec3;   // World position at init time — restore target on reset.
  az: number;
  el: number;
  depth: number;
}

@component
export class ViewConeLayout extends BaseScriptComponent {

  @input @allowUndefined
  @hint("Camera SceneObject (auto-discovers if empty)")
  cameraObj: SceneObject;

  // Defaults from tools/camera-intrinsics-empirical.json (multi-view chessboard
  // calibration of the lens-RT preview): effective vFov ≈ 57.3°, hFov defaults
  // to vFov for ~square per-eye Spectacles aspect. Override per-scene via
  // these inputs if the preview window aspect differs.
  @input @hint("Spectacles horizontal FOV (degrees) — empirical default")
  hFov: number = 57.3;

  @input @hint("Spectacles vertical FOV (degrees) — empirical default")
  vFov: number = 57.3;

  @input @hint("Angular padding between elements (degrees)")
  padding: number = 2.0;

  @input @hint("Position smoothing speed")
  smoothing: number = 4.0;

  @input @hint("Resolve every N frames")
  resolveInterval: number = 3;

  @input @hint("Max resolution passes per cycle")
  maxPasses: number = 8;

  @input @hint("Allow depth push to resolve overlaps")
  allowDepthPush: boolean = true;

  @input @hint("Depth push step (cm)")
  depthStep: number = 10;

  @input @hint("Run a resolve pass on init (otherwise wait for refresh()).")
  resolveOnInit: boolean = true;

  @input @hint("Remote-trigger name. Default 'resolve' / 'reset'. Override per-instance for multiple ViewConeLayouts in the same scene (e.g. 'resolve-uikit').")
  actionName: string = "resolve";

  private projector: ConeProjector | null = null;
  private cameraTr: Transform | null = null;
  private entries: SlotEntry[] = [];
  private frameCount: number = 0;
  private initialized: boolean = false;
  private lastChildCount: number = 0;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => this.init());
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
    var resolveName = this.actionName || "resolve";
    var resetName   = (this.actionName ? this.actionName : "resolve") + "-reset";
    if (resolveName === "resolve") resetName = "reset"; // back-compat
    this.createEvent("OnDestroyEvent").bind(() => {
      unregisterRemoteTrigger(resolveName);
      unregisterRemoteTrigger(resetName);
    });
    // Self-register named handlers so anything (web, another script, a CLI)
    // can drive the layout without holding a reference.
    registerRemoteTrigger(resolveName, () => this.refresh());
    registerRemoteTrigger(resetName,   () => this.resetToAuthored());
  }

  private init() {
    if (this.cameraObj) {
      this.cameraTr = this.cameraObj.getTransform();
    } else {
      try {
        var sfCam = (global as any).sfCamera;
        if (sfCam) this.cameraTr = sfCam.getTransform();
      } catch (e) {}
    }

    if (!this.cameraTr) {
      print("[ViewConeLayout] No camera found");
      return;
    }

    this.projector = new ConeProjector(this.cameraTr, this.hFov, this.vFov);
    this.collectSlots();
    this.lastChildCount = this.getSceneObject().getChildrenCount();
    this.initialized = true;

    // First resolve (optional — disable to keep an authored "before" state
    // until the SIK button / web triggers refresh()).
    if (this.resolveOnInit) {
      this.projectAll();
      this.resolve();
      this.applyTargets();
    } else {
      this.projectAll();
    }

    var camPosDbg = this.cameraTr!.getWorldPosition();
    var camFwdDbg = this.cameraTr!.forward;
    print("[ViewConeLayout] Ready: " + this.entries.length + " slots cam=" + camPosDbg.x.toFixed(1) + "," + camPosDbg.y.toFixed(1) + "," + camPosDbg.z.toFixed(1) + " fwd=" + camFwdDbg.x.toFixed(2) + "," + camFwdDbg.y.toFixed(2) + "," + camFwdDbg.z.toFixed(2));
    for (var di = 0; di < this.entries.length; di++) {
      var dp = this.entries[di].obj.getTransform().getWorldPosition();
      print("[ViewConeLayout] " + this.entries[di].obj.name + "@" + dp.x.toFixed(1) + "," + dp.y.toFixed(1) + "," + dp.z.toFixed(1));
    }
  }

  private collectSlots() {
    // Preserve previously authored positions across re-collects so a slot
    // added at runtime gets recorded once, but pre-existing slots keep
    // their original "before" position even if collectSlots runs again.
    const prior: { [k: string]: vec3 } = {};
    for (let i = 0; i < this.entries.length; i++) {
      prior[this.entries[i].obj.name] = this.entries[i].authoredPos;
    }

    this.entries = [];
    var root = this.getSceneObject();
    var count = root.getChildrenCount();
    for (var i = 0; i < count; i++) {
      var child = root.getChild(i);
      var components = child.getComponents("ScriptComponent");
      for (var ci = 0; ci < components.length; ci++) {
        var sc = components[ci] as any;
        if (sc && sc.sector !== undefined && sc.depthLane !== undefined && sc.priority !== undefined) {
          var pos = child.getTransform().getWorldPosition();
          var authored = prior[child.name] || new vec3(pos.x, pos.y, pos.z);
          this.entries.push({
            slot: sc as ConeSlot,
            obj: child,
            rect: null,
            targetPos: pos,
            authoredPos: authored,
            az: 0, el: 0,
            depth: pos.sub(this.cameraTr!.getWorldPosition()).length,
          });
          break;
        }
      }
    }
  }

  // ── Per-frame ─────────────────────────────────────────────────────

  private onUpdate() {
    if (!this.initialized || !this.projector || !this.cameraTr) return;
    var dt = getDeltaTime();
    this.frameCount++;

    this.projector.updateCamera(this.cameraTr);

    // Re-scan child SceneObjects when count changes (added/removed at runtime
    // via the editor or MCP). Cheap check — just reads count.
    var liveCount = this.getSceneObject().getChildrenCount();
    if (liveCount !== this.lastChildCount) {
      this.lastChildCount = liveCount;
      this.collectSlots();
    }

    if (this.frameCount % this.resolveInterval === 0) {
      this.projectAll();
      this.resolve();
    }

    // Smooth move
    var t = Math.min(1.0, this.smoothing * dt);
    for (var i = 0; i < this.entries.length; i++) {
      var e = this.entries[i];
      var cur = e.obj.getTransform().getWorldPosition();
      e.obj.getTransform().setWorldPosition(new vec3(
        cur.x + (e.targetPos.x - cur.x) * t,
        cur.y + (e.targetPos.y - cur.y) * t,
        cur.z + (e.targetPos.z - cur.z) * t
      ));
    }
  }

  // ── Project all entries to angular coords ─────────────────────────

  private projectAll() {
    for (var i = 0; i < this.entries.length; i++) {
      var e = this.entries[i];
      // Mesh-agnostic path first: any SceneObject with a BaseMeshVisual
      // (RenderMeshVisual, Image, Text, SIK button visuals, …) can be
      // angular-projected from its 8 world-AABB corners. Falls back to
      // the slot's authored width/height if no mesh is found (legacy
      // ConeSlot panels created via SlotMeshSetup before a mesh exists).
      e.rect = this.projector!.projectObjectAabb(e.obj);
      if (!e.rect) {
        var size = e.slot.getSize();
        e.rect = this.projector!.projectObject(e.obj, size.x, size.y);
      }
      if (e.rect) {
        e.az = e.rect.azimuth;
        e.el = e.rect.elevation;
        e.depth = e.rect.depth;
      }
    }
  }

  // ── Overlap resolution: angular push + optional depth push ────────

  private resolve() {
    // Sort by priority (highest first = least likely to move)
    var sorted = this.entries.slice().sort(function(a, b) {
      return b.slot.priority - a.slot.priority;
    });

    // Work in angular space — push overlapping rects apart
    // Each entry has mutable az, el, depth that we adjust
    var pad = this.padding;
    var RAD2DEG = 180 / Math.PI;

    for (var pass = 0; pass < this.maxPasses; pass++) {
      var anyPush = false;

      for (var i = 0; i < sorted.length; i++) {
        for (var j = i + 1; j < sorted.length; j++) {
          var a = sorted[i], b = sorted[j];
          if (!a.rect || !b.rect) continue;

          // Recompute angular extents at current depth
          var aSize = a.slot.getSize();
          var bSize = b.slot.getSize();
          var aHalfAz = Math.atan2(aSize.x * 0.5, a.depth) * RAD2DEG;
          var aHalfEl = Math.atan2(aSize.y * 0.5, a.depth) * RAD2DEG;
          var bHalfAz = Math.atan2(bSize.x * 0.5, b.depth) * RAD2DEG;
          var bHalfEl = Math.atan2(bSize.y * 0.5, b.depth) * RAD2DEG;

          var overlapX = (aHalfAz + bHalfAz + pad) - Math.abs(a.az - b.az);
          var overlapY = (aHalfEl + bHalfEl + pad) - Math.abs(a.el - b.el);

          if (overlapX > 0 && overlapY > 0) {
            anyPush = true;

            // Push along shortest axis. Higher priority (lower index) moves less.
            if (overlapX < overlapY) {
              var sign = a.az < b.az ? -1 : 1;
              a.az += sign * overlapX * 0.2;
              b.az -= sign * overlapX * 0.8;
            } else {
              var sign = a.el < b.el ? -1 : 1;
              a.el += sign * overlapY * 0.2;
              b.el -= sign * overlapY * 0.8;
            }

            // If lateral push would go outside FOV, try depth push instead
            if (this.allowDepthPush) {
              if (Math.abs(b.az) > this.hFov * 0.45 || Math.abs(b.el) > this.vFov * 0.45) {
                // Pull b forward (closer) — makes it appear bigger but clears the overlap
                // because its angular extent grows faster than the overlap
                b.depth = Math.max(20, b.depth - this.depthStep);
                // Reset lateral push — let depth handle it
                b.az = b.rect!.azimuth;
                b.el = b.rect!.elevation;
              }
            }
          }
        }
      }

      if (!anyPush) break;
    }

    // Convert resolved angular coords back to world positions
    var camPos = this.cameraTr!.getWorldPosition();
    var camFwd = this.cameraTr!.forward.uniformScale(-1);
    var camRight = this.cameraTr!.right;
    var camUp = this.cameraTr!.up;
    var DEG2RAD = Math.PI / 180;

    for (var i = 0; i < sorted.length; i++) {
      var e = sorted[i];
      var azRad = e.az * DEG2RAD;
      var elRad = e.el * DEG2RAD;
      var fwd = e.depth * Math.cos(elRad) * Math.cos(azRad);
      var right = e.depth * Math.cos(elRad) * Math.sin(azRad);
      var up = e.depth * Math.sin(elRad);

      e.targetPos = new vec3(
        camPos.x + camFwd.x * fwd + camRight.x * right + camUp.x * up,
        camPos.y + camFwd.y * fwd + camRight.y * right + camUp.y * up,
        camPos.z + camFwd.z * fwd + camRight.z * right + camUp.z * up
      );

      var legible = e.rect ? this.projector!.isLegible(e.rect, e.slot.minAngularHeight) : true;
      e.slot._setResolved(
        legible ? "ok" : "illegible",
        e.depth < 50 ? "near" : e.depth < 80 ? "mid" : "far"
      );
    }
  }

  private applyTargets() {
    for (var i = 0; i < this.entries.length; i++) {
      this.entries[i].obj.getTransform().setWorldPosition(this.entries[i].targetPos);
    }
  }

  // ── Public API ────────────────────────────────────────────────────

  refresh() {
    this.collectSlots();
    this.projectAll();
    // Diagnostic: dump every entry's projected rect so we can see whether
    // projection found a mesh + where the resolver thinks they sit.
    for (var i = 0; i < this.entries.length; i++) {
      var e = this.entries[i];
      if (e.rect) {
        print('[ViewConeLayout:' + (this.actionName || 'resolve') + '] ' +
          e.obj.name + ' az=' + e.rect.azimuth.toFixed(1) +
          ' el=' + e.rect.elevation.toFixed(1) +
          ' depth=' + e.rect.depth.toFixed(1) +
          ' angW=' + e.rect.angularWidth.toFixed(1) +
          ' angH=' + e.rect.angularHeight.toFixed(1));
      } else {
        print('[ViewConeLayout:' + (this.actionName || 'resolve') + '] ' +
          e.obj.name + ' NO RECT (no mesh found in subtree)');
      }
    }
    this.resolve();
  }

  /**
   * Snap every slot back to the position it had at init time and clear any
   * pending resolution. Re-projects so the next refresh() starts from the
   * "before" state — equivalent to "Reset Positions" in the web demo.
   */
  resetToAuthored() {
    for (var i = 0; i < this.entries.length; i++) {
      var e = this.entries[i];
      e.targetPos = new vec3(e.authoredPos.x, e.authoredPos.y, e.authoredPos.z);
      e.obj.getTransform().setWorldPosition(e.targetPos);
    }
    if (this.projector && this.cameraTr) {
      this.projector.updateCamera(this.cameraTr);
      this.projectAll();
    }
    print('[ViewConeLayout] reset to authored positions (' + this.entries.length + ' slots)');
  }

  getOverlapCount(): number {
    if (!this.projector) return 0;
    var rects: AngularRect[] = [];
    for (var i = 0; i < this.entries.length; i++) {
      if (this.entries[i].rect) rects.push(this.entries[i].rect!);
    }
    return this.projector.detectOverlaps(rects).length;
  }
}
