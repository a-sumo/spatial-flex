/**
 * ConeProjector.ts — Projects scene elements into view-cone angular space.
 *
 * Computes azimuth, elevation, depth, and angular extent for any
 * SceneObject relative to the camera. Detects angular overlaps.
 *
 * Usage:
 *   var proj = new ConeProjector(cameraTransform);
 *   var rect = proj.project(sceneObject, width, height);
 *   var overlaps = proj.detectOverlaps(rects);
 */

var RAD2DEG = 180 / Math.PI;

export interface AngularRect {
  name: string;
  azimuth: number;     // degrees, center
  elevation: number;   // degrees, center
  depth: number;       // cm
  azMin: number; azMax: number;
  elMin: number; elMax: number;
  angularWidth: number;
  angularHeight: number;
  sector: string;
}

export interface OverlapPair {
  a: string;
  b: string;
  overlapArea: number; // approximate angular overlap in sq degrees
}

var SECTOR_NAMES: {[k: string]: string} = {
  "TL": "TOP-LEFT", "TC": "TOP", "TR": "TOP-RIGHT",
  "ML": "LEFT", "MC": "CENTER", "MR": "RIGHT",
  "BL": "BOT-LEFT", "BC": "BOTTOM", "BR": "BOT-RIGHT",
};

export class ConeProjector {
  private camPos: vec3;
  private camFwd: vec3;
  private camRight: vec3;
  private camUp: vec3;
  private hFov: number;
  private vFov: number;

  constructor(cameraTr: Transform, hFov: number = 50, vFov: number = 30) {
    this.camPos = cameraTr.getWorldPosition();
    this.camFwd = cameraTr.forward.uniformScale(-1);
    this.camRight = cameraTr.right;
    this.camUp = cameraTr.up;
    this.hFov = hFov;
    this.vFov = vFov;
  }

  /** Update from current camera transform (call per frame). */
  updateCamera(cameraTr: Transform) {
    this.camPos = cameraTr.getWorldPosition();
    this.camFwd = cameraTr.forward.uniformScale(-1);
    this.camRight = cameraTr.right;
    this.camUp = cameraTr.up;
  }

  /**
   * Project a scene element to angular coordinates.
   * @param worldPos — center of the element in world space
   * @param width — world width in cm
   * @param height — world height in cm
   * @param name — identifier for overlap reporting
   */
  project(worldPos: vec3, width: number, height: number, name: string): AngularRect | null {
    var delta = worldPos.sub(this.camPos);
    var lx = delta.dot(this.camRight);
    var ly = delta.dot(this.camUp);
    var lz = delta.dot(this.camFwd);

    if (lz <= 0.1) return null; // behind camera

    var az = Math.atan2(lx, lz) * RAD2DEG;
    var el = Math.atan2(ly, lz) * RAD2DEG;
    var depth = delta.length;

    var halfW = width * 0.5;
    var halfH = height * 0.5;
    var azExt = Math.atan2(halfW, lz) * RAD2DEG;
    var elExt = Math.atan2(halfH, lz) * RAD2DEG;

    return {
      name: name,
      azimuth: az, elevation: el, depth: depth,
      azMin: az - azExt, azMax: az + azExt,
      elMin: el - elExt, elMax: el + elExt,
      angularWidth: azExt * 2,
      angularHeight: elExt * 2,
      sector: this.classifySector(az, el),
    };
  }

  /** Project a SceneObject using its transform + known dimensions. */
  projectObject(obj: SceneObject, width: number, height: number): AngularRect | null {
    var worldPos = obj.getTransform().getWorldPosition();
    // Account for scale
    var scale = obj.getTransform().getWorldScale();
    return this.project(worldPos, width * scale.x, height * scale.y, obj.name);
  }

  /**
   * Mesh-agnostic angular projection. Aggregates the world AABB of every
   * BaseMeshVisual in `obj`'s entire subtree (RenderMeshVisual, Image,
   * Text, SIK button visuals which sit on runtime-created children, …),
   * projects all 8 corners of the combined AABB to angular space, and
   * returns the bounding rect that encloses every projected corner. Works
   * for any 3D shape — without needing an authored width/height.
   *
   * For thin/long shapes the AABB overestimates angular extent slightly;
   * fine for overlap resolution, conservatively wider is safer here.
   */
  projectObjectAabb(obj: SceneObject): AngularRect | null {
    var aMin: any = null;
    var aMax: any = null;

    var visit = function(o: SceneObject) {
      var v = o.getComponent('Component.BaseMeshVisual') as any;
      if (v && typeof v.worldAabbMin === 'function') {
        var mn = v.worldAabbMin();
        var mx = v.worldAabbMax();
        if (mn && mx) {
          // First mesh seeds the bounds; subsequent meshes union in.
          if (!aMin) {
            aMin = { x: mn.x, y: mn.y, z: mn.z };
            aMax = { x: mx.x, y: mx.y, z: mx.z };
          } else {
            if (mn.x < aMin.x) aMin.x = mn.x;
            if (mn.y < aMin.y) aMin.y = mn.y;
            if (mn.z < aMin.z) aMin.z = mn.z;
            if (mx.x > aMax.x) aMax.x = mx.x;
            if (mx.y > aMax.y) aMax.y = mx.y;
            if (mx.z > aMax.z) aMax.z = mx.z;
          }
        }
      }
      var n = o.getChildrenCount();
      for (var i = 0; i < n; i++) visit(o.getChild(i));
    };
    visit(obj);

    if (!aMin || !aMax) return null;

    // 8 AABB corners
    var xs = [aMin.x, aMax.x];
    var ys = [aMin.y, aMax.y];
    var zs = [aMin.z, aMax.z];

    var azMin = Infinity, azMax = -Infinity;
    var elMin = Infinity, elMax = -Infinity;
    var minDepth = Infinity, sumDepth = 0, depthCount = 0;

    for (var i = 0; i < 2; i++) {
      for (var j = 0; j < 2; j++) {
        for (var k = 0; k < 2; k++) {
          var dx = xs[i] - this.camPos.x;
          var dy = ys[j] - this.camPos.y;
          var dz = zs[k] - this.camPos.z;
          var lx = dx * this.camRight.x + dy * this.camRight.y + dz * this.camRight.z;
          var ly = dx * this.camUp.x    + dy * this.camUp.y    + dz * this.camUp.z;
          var lz = dx * this.camFwd.x   + dy * this.camFwd.y   + dz * this.camFwd.z;
          if (lz <= 0.1) continue;  // corner behind camera; skip
          var az = Math.atan2(lx, lz) * RAD2DEG;
          var el = Math.atan2(ly, lz) * RAD2DEG;
          if (az < azMin) azMin = az;
          if (az > azMax) azMax = az;
          if (el < elMin) elMin = el;
          if (el > elMax) elMax = el;
          if (lz < minDepth) minDepth = lz;
          sumDepth += lz; depthCount++;
        }
      }
    }
    if (azMin === Infinity || depthCount === 0) return null;

    var az = (azMin + azMax) * 0.5;
    var el = (elMin + elMax) * 0.5;
    var depth = sumDepth / depthCount;

    return {
      name: obj.name,
      azimuth: az, elevation: el, depth: depth,
      azMin: azMin, azMax: azMax,
      elMin: elMin, elMax: elMax,
      angularWidth:  azMax - azMin,
      angularHeight: elMax - elMin,
      sector: this.classifySector(az, el),
    };
  }

  /** Detect all pairwise overlaps in a list of angular rects. */
  detectOverlaps(rects: AngularRect[]): OverlapPair[] {
    var overlaps: OverlapPair[] = [];
    for (var i = 0; i < rects.length; i++) {
      for (var j = i + 1; j < rects.length; j++) {
        var a = rects[i], b = rects[j];
        var hOverlap = Math.max(0, Math.min(a.azMax, b.azMax) - Math.max(a.azMin, b.azMin));
        var vOverlap = Math.max(0, Math.min(a.elMax, b.elMax) - Math.max(a.elMin, b.elMin));
        if (hOverlap > 0 && vOverlap > 0) {
          overlaps.push({ a: a.name, b: b.name, overlapArea: hOverlap * vOverlap });
        }
      }
    }
    return overlaps;
  }

  /** Check if an element meets minimum angular size for legibility. */
  isLegible(rect: AngularRect, minAngularHeight: number = 0.5): boolean {
    return rect.angularHeight >= minAngularHeight;
  }

  /** Classify azimuth/elevation into a 3x3 sector grid. */
  private classifySector(az: number, el: number): string {
    var hThird = this.hFov / 6;
    var vThird = this.vFov / 6;
    var h = az < -hThird ? "L" : (az > hThird ? "R" : "C");
    var v = el > vThird ? "T" : (el < -vThird ? "B" : "M");
    return SECTOR_NAMES[v + h] || "?";
  }

  /** Get the FOV bounds. */
  getFovBounds(): { azMin: number; azMax: number; elMin: number; elMax: number } {
    return {
      azMin: -this.hFov * 0.5, azMax: this.hFov * 0.5,
      elMin: -this.vFov * 0.5, elMax: this.vFov * 0.5,
    };
  }
}
