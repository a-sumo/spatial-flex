/**
 * TextShrinkwrap — walks descendants under `root` and configures every
 * Text component for "fit text to panel": wrap horizontally, shrink to
 * fit vertically. Lens Studio's built-in overflow modes do this natively.
 *
 * Run once on start, plus the `text-shrinkwrap` remote trigger so the web
 * demo can reapply after slots are added at runtime.
 */

import { registerRemoteTrigger, unregisterRemoteTrigger } from '../Streaming/RemoteTriggers';

@component
export class TextShrinkwrap extends BaseScriptComponent {

  @input
  @allowUndefined
  @hint('Walk this object\'s descendants. Empty = self.')
  public root: SceneObject;

  @input
  @allowUndefined
  @hint('If set, assign this Font to any Text that has none. Required for size changes to render — the default fallback renderer ignores text.size.')
  public defaultFont: Font;

  @input
  @hint('Run on start in addition to the remote trigger.')
  public runOnStart: boolean = true;

  @input
  public verbose: boolean = true;

  onAwake() {
    this.createEvent('OnStartEvent').bind(() => {
      if (this.runOnStart) this.apply();
      registerRemoteTrigger('text-shrinkwrap', () => this.apply());
    });
    this.createEvent('OnDestroyEvent').bind(() =>
      unregisterRemoteTrigger('text-shrinkwrap')
    );
  }

  public apply() {
    const root = this.root || this.getSceneObject();
    let n = 0;
    let nFontFixed = 0;
    this.walk(root, (obj) => {
      const text = obj.getComponent('Component.Text') as Text;
      if (!text) return;
      // Wrap horizontally, "shrink to fit" vertically. LS doesn't have a
      // VerticalOverflow.Shrink — sizeToFit is the official auto-shrink
      // mechanism; it scales the rendered glyph height down until the
      // text fits the worldSpaceRect.
      text.horizontalOverflow = HorizontalOverflow.Wrap;
      text.sizeToFit = true;
      // Without a font, LS's default renderer ignores text.size. Assign a
      // real font so glyphs scale on size change.
      if (this.defaultFont && !text.font) {
        text.font = this.defaultFont;
        nFontFixed++;
      }
      n++;
    });
    if (this.verbose) {
      print('[TextShrinkwrap] configured ' + n + ' Text(s)' +
        (nFontFixed ? ', assigned font to ' + nFontFixed : ''));
    }
  }

  private walk(obj: SceneObject, visit: (o: SceneObject) => void) {
    visit(obj);
    const c = obj.getChildrenCount();
    for (let i = 0; i < c; i++) this.walk(obj.getChild(i), visit);
  }
}
