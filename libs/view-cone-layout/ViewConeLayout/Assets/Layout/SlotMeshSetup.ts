/**
 * SlotMeshSetup.ts — Replaces every direct child's RMV mesh with a procedurally
 * built XY-plane quad (normal +Z), so slot.scale.{x,y} maps cleanly to visible
 * width/height and rotation (0, 0, 0) means "facing the camera that looks -Z".
 *
 * The default LS Plane.mesh is XZ-aligned (normal +Y), which makes the slots
 * edge-on to the camera at zero rotation and gives ConeSlot.getSize() a 0
 * height (because mesh.aabb.y = 0). Building our own quad sidesteps both.
 *
 * Attach to ViewConeRoot. The mesh is generated once on start and shared
 * across every child RenderMeshVisual.
 */
@component
export class SlotMeshSetup extends BaseScriptComponent {

  @input
  @hint('Edge length of the generated quad in mesh-local units. Slot transform scale multiplies on top — e.g. unitSize=1 + slot scale (8,8,1) gives an 8×8 cm panel.')
  public unitSize: number = 1;

  @input
  @hint('Re-apply when child count changes (e.g. slots added/removed at runtime).')
  public watchChildren: boolean = true;

  private mesh: RenderMesh | null = null;
  private lastChildCount: number = -1;

  onAwake() {
    this.createEvent('OnStartEvent').bind(() => {
      this.mesh = this.buildQuad(this.unitSize);
      this.applyToChildren();
    });
    if (this.watchChildren) {
      this.createEvent('UpdateEvent').bind(() => {
        const c = this.getSceneObject().getChildrenCount();
        if (c !== this.lastChildCount) {
          this.lastChildCount = c;
          this.applyToChildren();
        }
      });
    }
  }

  private applyToChildren() {
    if (!this.mesh) return;
    const root = this.getSceneObject();
    const count = root.getChildrenCount();
    this.lastChildCount = count;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const child = root.getChild(i);
      const rmv = child.getComponent('Component.RenderMeshVisual') as RenderMeshVisual;
      if (rmv) {
        rmv.mesh = this.mesh;
        n++;
      }
    }
    print('[SlotMeshSetup] mesh applied to ' + n + ' child RMV(s).');
  }

  private buildQuad(size: number): RenderMesh {
    const h = size * 0.5;
    const builder = new MeshBuilder([
      { name: 'position', components: 3 },
      { name: 'normal',   components: 3 },
      { name: 'texture0', components: 2 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;

    // XY-plane quad, normal +Z, UVs 0..1
    builder.appendVerticesInterleaved([
      -h, -h, 0,  0, 0, 1,  0, 0,
       h, -h, 0,  0, 0, 1,  1, 0,
       h,  h, 0,  0, 0, 1,  1, 1,
      -h,  h, 0,  0, 0, 1,  0, 1,
    ]);
    builder.appendIndices([0, 1, 2,  0, 2, 3]);
    builder.updateMesh();
    return builder.getMesh();
  }
}
