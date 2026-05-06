import { createClient } from 'SupabaseClient.lspkg/supabase-snapcloud';
import { SnapCloudRequirements } from '../VideoCapture/Scripts/SnapCloudRequirements';
import { registerRemoteTrigger, unregisterRemoteTrigger } from './RemoteTriggers';

/**
 * Sends preview-render JPEGs to a Supabase Realtime channel.
 * Wire-compatible with the SnapCloud composite-stream-viewer.html.
 *
 * Default mode: SNAPSHOT-ONLY. The streamer authenticates and subscribes
 * but sends nothing until something fires the `snapshot` remote trigger
 * (web button, agent, etc.) — keeps Snap Cloud quota near zero. Continuous
 * streaming is opt-in via the `continuous` input or the `stream-start` /
 * `stream-stop` remote triggers.
 *
 * Use mode=composite for the web viewer.
 */
@component
export class LayoutPreviewStreamer extends BaseScriptComponent {

  @input
  @hint('SnapCloudRequirements component holding the SupabaseProject')
  public snapCloudRequirements: SnapCloudRequirements;

  @input
  @hint('Realtime channel name. Paste the same value in the browser viewer.')
  public channelName: string = 'viewcone-live-stream';

  @input
  @widget(new ComboBoxWidget([
    new ComboBoxItem('composite', 'composite'),
    new ComboBoxItem('lens', 'lens'),
  ]))
  @hint('Which texture to capture: composite (camera + lens) or lens (lens-only).')
  public mode: string = 'composite';

  @input
  @hint('Composite render output (camera + lens). Used when mode=composite.')
  @allowUndefined
  public compositeTexture: Texture;

  @input
  @hint('Lens-only render output. Used when mode=lens.')
  @allowUndefined
  public lensTexture: Texture;

  @input
  @widget(new SliderWidget(1, 30, 1))
  @hint('Streaming fps when continuous=true. Snapshot mode ignores this.')
  public fps: number = 2;

  @input
  @hint('Stream JPEGs continuously instead of on-demand. Default off (snapshot-only) to keep Snap Cloud quota near zero.')
  public continuous: boolean = false;

  @input
  @hint('Override simulator aspect (W/H). Spectacles per-eye native = 2/3 = 0.6667. Web viewer crops centre-out to this ratio.')
  public displayAspect: number = 0.6667;

  @input
  @widget(new SliderWidget(1, 100, 1))
  @hint('JPEG quality. <=70 uses IntermediateQuality, >70 uses HighQuality.')
  public quality: number = 50;

  @input
  @hint('When continuous=true, start streaming as soon as the channel is subscribed.')
  public autoStart: boolean = true;

  @input
  public enableDebugLogs: boolean = true;

  private client: any = null;
  private channel: any = null;
  private subscribed: boolean = false;
  private streaming: boolean = false;
  private encoding: boolean = false;

  private frameCount: number = 0;
  private sessionId: string = '';
  private lastFrameAt: number = 0;
  private updateEvent: UpdateEvent;

  onAwake() {
    if (!this.snapCloudRequirements) {
      this.err('Missing snapCloudRequirements input');
      return;
    }
    this.createEvent('OnStartEvent').bind(() => this.onStart());
    this.createEvent('OnDestroyEvent').bind(() => this.cleanup());

    // Remote triggers — let the web (or any agent) drive the streamer
    // without pointer-injection.
    registerRemoteTrigger('snapshot',     () => this.snapshot());
    registerRemoteTrigger('stream-start', () => this.startStreaming());
    registerRemoteTrigger('stream-stop',  () => this.stopStreaming());
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
        this.err(`Snap Cloud auth failed: ${JSON.stringify(authError)}`);
        return;
      }
      this.log('Snap Cloud auth ok');

      this.channel = this.client.channel(this.channelName, {
        config: { broadcast: { self: false } },
      });

      this.channel.on('broadcast', { event: 'viewer-joined' }, (msg: any) => {
        this.log(`viewer joined: ${msg.payload && msg.payload.viewerId}`);
      });

      this.channel.subscribe((status: string) => {
        this.log(`channel "${this.channelName}" status: ${status}`);
        if (status === 'SUBSCRIBED') {
          this.subscribed = true;
          this.sendStreamInit();
          // Continuous mode is opt-in. Snapshot mode just sits subscribed,
          // ready to fire one frame on demand.
          if (this.continuous && this.autoStart) this.startStreaming();
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.subscribed = false;
        }
      });
    } catch (e) {
      this.err(`createClient/subscribe failed: ${e}`);
    }
  }

  public startStreaming() {
    if (this.streaming) return;
    if (!this.subscribed) {
      this.log('startStreaming deferred until channel is subscribed');
      return;
    }
    this.streaming = true;
    this.frameCount = 0;
    this.sessionId = `viewcone-${Date.now()}`;
    this.lastFrameAt = 0;
    this.updateEvent = this.createEvent('UpdateEvent');
    this.updateEvent.bind(() => this.tick());
    this.broadcast('composite-stream-started', {
      sessionId: this.sessionId,
      timestamp: Date.now(),
      metadata: this.frameMetadata(),
    });
    this.log(`streaming started on channel "${this.channelName}"`);
  }

  public stopStreaming() {
    if (!this.streaming) return;
    this.streaming = false;
    if (this.updateEvent) this.updateEvent.enabled = false;
    this.broadcast('composite-stream-ended', {
      sessionId: this.sessionId,
      timestamp: Date.now(),
      totalFrames: this.frameCount,
    });
  }

  public setMode(mode: string) {
    if (mode !== 'composite' && mode !== 'lens') return;
    this.mode = mode;
    this.log(`mode -> ${mode}`);
  }

  /**
   * Send a single JPEG frame on demand. Independent of `continuous` —
   * works whether or not periodic streaming is active. Call from the
   * `snapshot` remote trigger or any agent code.
   */
  public snapshot() {
    if (!this.subscribed) {
      this.log('snapshot deferred — channel not subscribed yet');
      return;
    }
    if (this.encoding) {
      this.log('snapshot dropped — encoder busy');
      return;
    }
    const tex = this.pickTexture();
    if (!tex) {
      this.err('snapshot: no texture to capture');
      return;
    }
    if (!this.sessionId) this.sessionId = `viewcone-${Date.now()}`;
    this.encodeAndSend(tex);
    this.log('snapshot fired');
  }

  private tick() {
    if (!this.streaming || this.encoding) return;
    const now = getTime() * 1000;
    const interval = 1000 / Math.max(1, this.fps);
    if (this.lastFrameAt && now - this.lastFrameAt < interval) return;
    const tex = this.pickTexture();
    if (!tex) return;
    this.lastFrameAt = now;
    this.encodeAndSend(tex);
  }

  private pickTexture(): Texture | null {
    if (this.mode === 'lens' && this.lensTexture) return this.lensTexture;
    if (this.compositeTexture) return this.compositeTexture;
    return this.lensTexture || null;
  }

  private encodeAndSend(tex: Texture) {
    this.encoding = true;
    const q = this.quality > 70
      ? CompressionQuality.HighQuality
      : CompressionQuality.IntermediateQuality;

    Base64.encodeTextureAsync(
      tex,
      (encoded: string) => {
        this.encoding = false;
        const frameNumber = ++this.frameCount;
        const timestamp = Date.now();
        this.broadcast('composite-video-frame', {
          frameData: encoded,
          frameNumber,
          timestamp,
          sessionId: this.sessionId,
          metadata: this.frameMetadata(),
        });
      },
      () => {
        this.encoding = false;
        this.err('encodeTextureAsync failed');
      },
      q,
      EncodingType.Jpg,
    );
  }

  private sendStreamInit() {
    this.broadcast('composite-stream-init', {
      channelName: this.channelName,
      timestamp: Date.now(),
      settings: {
        video: { fps: this.fps, quality: this.quality, resolution: 1.0 },
        display: this.frameMetadata(),
        audio: { sampleRate: 16000, chunkSizeMs: 100, compression: 0 },
      },
    });
  }

  private frameMetadata() {
    // Aspect priority: explicit @input override > live texture dims.
    // Live texture dims correctly reflect an unstretched editor window
    // (JPEG aspect == simulator aspect, no crop needed). Override is for
    // the case where the user stretched the preview and wants the JPEG
    // cropped centre-out back to the true active rendering area.
    let aspect = this.displayAspect;
    if (!(aspect > 0)) {
      const tex = this.pickTexture();
      if (tex) {
        const w = tex.getWidth();
        const h = tex.getHeight();
        if (w > 0 && h > 0) aspect = w / h;
      }
    }
    if (!(aspect > 0)) aspect = 1;
    return {
      mode: this.mode,
      quality: this.quality,
      fps: this.fps,
      displayAspect: aspect,
      fit: 'crop',
      source: this.mode === 'lens' ? 'raw-lens-render-target' : 'composite-render-target',
    };
  }

  private broadcast(event: string, payload: any) {
    if (!this.channel || !this.subscribed) return;
    try {
      this.channel.send({ type: 'broadcast', event, payload });
    } catch (e) {
      this.err(`broadcast(${event}) failed: ${e}`);
    }
  }

  private cleanup() {
    this.stopStreaming();
    unregisterRemoteTrigger('snapshot');
    unregisterRemoteTrigger('stream-start');
    unregisterRemoteTrigger('stream-stop');
    if (this.channel) {
      try { this.channel.unsubscribe(); } catch (e) { /* */ }
    }
  }

  private log(m: string) {
    if (this.enableDebugLogs) print(`[LayoutPreviewStreamer] ${m}`);
  }
  private err(m: string) {
    print(`[LayoutPreviewStreamer ERROR] ${m}`);
  }
}
