import { createClient } from 'SupabaseClient.lspkg/supabase-snapcloud';
import { SnapCloudRequirements } from '../VideoCapture/Scripts/SnapCloudRequirements';
import { ConeSlot } from '../Layout/ConeSlot';
import { fireRemoteTrigger, listRemoteTriggers } from './RemoteTriggers';

/**
 * Broadcasts a periodic snapshot of every ConeSlot under `slotsRoot` on the
 * same Supabase channel as the JPEG streamer, and listens for inbound
 * cone-slots-update messages from the web demo.
 *
 * Frame: each slot position is camera-local, in centimetres.
 *   x = camRight  · (slotWorld − camWorld)
 *   y = camUp     · (slotWorld − camWorld)
 *   z = camForward· (slotWorld − camWorld)   (positive in front of camera)
 *
 * The web demo treats z as -depth in three.js convention.
 *
 * NOTE: while web-driven layout is the source of truth (i.e. you push back
 * cone-slots-update from the demo), uncheck ViewConeLayout on ViewConeRoot —
 * otherwise it will smooth slot positions back toward its own resolution.
 */
@component
export class SlotStateBroadcaster extends BaseScriptComponent {

  @input
  @hint('SnapCloudRequirements component holding the SupabaseProject.')
  public snapCloudRequirements: SnapCloudRequirements;

  @input
  @hint('Realtime channel name. Match the streamer + viewer.')
  public channelName: string = 'viewcone-live-stream';

  @input
  @hint('Root SceneObject whose direct children carry ConeSlot components.')
  public slotsRoot: SceneObject;

  @input
  @allowUndefined
  @hint('Camera SceneObject. Required — used to compute camera-local frame.')
  public cameraObj: SceneObject;

  @input
  @widget(new SliderWidget(1, 30, 1))
  @hint('Snapshots per second.')
  public fps: number = 5;

  @input
  @hint('Apply inbound cone-slots-update messages to slot world positions.')
  public acceptUpdates: boolean = true;

  @input
  @hint('Enable debug logs.')
  public enableDebugLogs: boolean = true;

  private client: any = null;
  private channel: any = null;
  private subscribed: boolean = false;
  private lastSendAt: number = 0;
  private updateEvent: UpdateEvent;

  onAwake() {
    if (!this.snapCloudRequirements) {
      this.err('Missing snapCloudRequirements input');
      return;
    }
    if (!this.slotsRoot) {
      this.err('Missing slotsRoot input');
      return;
    }
    this.createEvent('OnStartEvent').bind(() => this.onStart());
    this.createEvent('OnDestroyEvent').bind(() => this.cleanup());
    this.updateEvent = this.createEvent('UpdateEvent');
    this.updateEvent.bind(() => this.tick());
  }

  private async onStart() {
    const project = this.snapCloudRequirements.getSupabaseProject();
    if (!project || !project.url) {
      this.err('SupabaseProject not configured. Window > Supabase > Import Credentials.');
      return;
    }
    try {
      this.client = createClient(project.url, project.publicToken);
      const { error: authError } = await this.client.auth.signInWithIdToken({
        provider: 'snapchat',
        token: '',
      });
      if (authError) {
        this.err('Snap Cloud auth failed: ' + JSON.stringify(authError));
        return;
      }
      this.log('Snap Cloud auth ok');

      this.channel = this.client.channel(this.channelName, {
        config: { broadcast: { self: false } },
      });

      this.channel.on('broadcast', { event: 'cone-slots-update' }, (msg: any) => {
        if (this.acceptUpdates) this.applyUpdate(msg.payload);
      });

      // Web → LS UI intent. payload: { target: 'resolve' | ... }
      // Same code path as a SIK button press; web drives the loop without
      // touching the LS preview window.
      this.channel.on('broadcast', { event: 'ui-trigger' }, (msg: any) => {
        this.applyTrigger(msg.payload);
      });

      this.channel.subscribe((status: string) => {
        this.log('channel "' + this.channelName + '" status: ' + status);
        if (status === 'SUBSCRIBED') {
          this.subscribed = true;
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.subscribed = false;
        }
      });
    } catch (e) {
      this.err('createClient/subscribe failed: ' + e);
    }
  }

  private tick() {
    if (!this.subscribed) return;
    const now = getTime() * 1000;
    const interval = 1000 / Math.max(1, this.fps);
    if (this.lastSendAt && now - this.lastSendAt < interval) return;
    this.lastSendAt = now;
    this.sendSnapshot();
  }

  private sendSnapshot() {
    if (!this.cameraObj) return;
    const camTr = this.cameraObj.getTransform();
    const camPos = camTr.getWorldPosition();
    const camFwd = camTr.forward.uniformScale(-1); // camera renders along -localZ
    const camRight = camTr.right;
    const camUp = camTr.up;

    const root = this.slotsRoot;
    const count = root.getChildrenCount();
    const slots: any[] = [];

    for (let i = 0; i < count; i++) {
      const child = root.getChild(i);
      if (!child.enabled) continue;
      const cone = this.findConeSlot(child);
      if (!cone) continue;

      const wp = child.getTransform().getWorldPosition();
      const delta = wp.sub(camPos);
      const localX = delta.dot(camRight);
      const localY = delta.dot(camUp);
      const localZ = delta.dot(camFwd);
      // ConeSlot.getSize() reads mesh.aabb which for the standard LS Plane.mesh
      // has y-extent = 0 — gives h=0 on the wire. Use the SceneObject's world
      // scale directly: for a slot that's a 1×1 unit Plane scaled in X/Y, the
      // visible rect dims are (scale.x, scale.y). This skips the aabb path
      // entirely so authored slot scale → broadcasted size 1:1.
      const wScale = child.getTransform().getWorldScale();
      const size = { x: wScale.x, y: wScale.y };

      let text: string = '';
      const txt = child.getComponent('Component.Text') as Text;
      if (txt) text = txt.text;

      slots.push({
        name: child.name,
        x: localX, y: localY, z: localZ,             // camera-local cm
        w: size.x, h: size.y,                         // cm
        text: text,
        sector: cone.sector,
        depthLane: cone.depthLane,
        priority: cone.priority,
        pushable: cone.pushable,
        depthFlexible: cone.depthFlexible,
        minAngularHeight: cone.minAngularHeight,
      });
    }

    this.broadcast('cone-slots-state', {
      timestamp: Date.now(),
      unit: 'cm',
      frame: 'camera-local',
      slots: slots,
    });
  }

  private findConeSlot(child: SceneObject): ConeSlot | null {
    const components = child.getComponents('ScriptComponent');
    for (let i = 0; i < components.length; i++) {
      const sc = components[i] as any;
      if (sc && sc.sector !== undefined && sc.depthLane !== undefined && sc.priority !== undefined) {
        return sc as ConeSlot;
      }
    }
    return null;
  }

  /**
   * Apply an incoming cone-slots-update payload. Each entry: { name, x, y, z }
   * in camera-local cm by default. World-space frame supported via
   * payload.frame === 'world'.
   */
  private applyUpdate(payload: any) {
    if (!payload || !payload.slots || !this.cameraObj) return;

    const camTr = this.cameraObj.getTransform();
    const camPos = camTr.getWorldPosition();
    const camFwd = camTr.forward.uniformScale(-1);
    const camRight = camTr.right;
    const camUp = camTr.up;

    const root = this.slotsRoot;
    const childCount = root.getChildrenCount();
    const byName: { [k: string]: SceneObject } = {};
    for (let i = 0; i < childCount; i++) {
      const c = root.getChild(i);
      byName[c.name] = c;
    }

    const frame = payload.frame || 'camera-local';
    const unit = payload.unit || 'cm';
    const k = unit === 'm' ? 100 : 1; // bring everything into LS cm

    let n = 0;
    for (let i = 0; i < payload.slots.length; i++) {
      const s = payload.slots[i];
      const obj = byName[s.name];
      if (!obj) continue;
      const lx = s.x * k, ly = s.y * k, lz = s.z * k;
      let world: vec3;
      if (frame === 'world') {
        world = new vec3(lx, ly, lz);
      } else {
        world = new vec3(
          camPos.x + camRight.x * lx + camUp.x * ly + camFwd.x * lz,
          camPos.y + camRight.y * lx + camUp.y * ly + camFwd.y * lz,
          camPos.z + camRight.z * lx + camUp.z * ly + camFwd.z * lz,
        );
      }
      obj.getTransform().setWorldPosition(world);
      n++;
    }
    this.log('applied update for ' + n + ' slot(s)');
  }

  /**
   * Web → LS named intent. Resolved via the global RemoteTriggers registry
   * — any script can register a handler for any name, no scene-graph wiring
   * needed here. New actions = `registerRemoteTrigger("foo", fn)` in the
   * owning script's onAwake.
   */
  private applyTrigger(payload: any) {
    if (!payload) return;
    const target = payload.target;
    if (typeof target !== 'string') return;
    if (fireRemoteTrigger(target)) {
      this.log('ui-trigger fired: ' + target);
    } else {
      this.log('ui-trigger no handler for "' + target + '" (registered: ' +
        listRemoteTriggers().join(',') + ')');
    }
  }

  private broadcast(event: string, payload: any) {
    if (!this.channel || !this.subscribed) return;
    try {
      this.channel.send({ type: 'broadcast', event: event, payload: payload });
    } catch (e) {
      this.err('broadcast(' + event + ') failed: ' + e);
    }
  }

  private cleanup() {
    if (this.updateEvent) this.updateEvent.enabled = false;
    if (this.channel) {
      try { this.channel.unsubscribe(); } catch (e) { /* */ }
    }
  }

  private log(m: string) {
    if (this.enableDebugLogs) print('[SlotStateBroadcaster] ' + m);
  }
  private err(m: string) {
    print('[SlotStateBroadcaster ERROR] ' + m);
  }
}
