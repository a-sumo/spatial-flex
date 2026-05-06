import { ViewConeLayout } from './ViewConeLayout';

/**
 * Hooks the SpectaclesUIKit RectangleButton (or any UIKit Element-based
 * component) on the same SceneObject:  onTriggerUp → ViewConeLayout.refresh().
 *
 * Attach to a LabelledButton-instantiated SceneObject. Duck-types instead of
 * importing RectangleButton directly so the script doesn't get blocked if the
 * UIKit package gets restructured. Just looks for any ScriptComponent on this
 * object that exposes `onTriggerUp.add`.
 */
@component
export class ResolveButton extends BaseScriptComponent {

  @input
  @hint('ViewConeLayout instance whose refresh() runs on click.')
  public layout: ViewConeLayout;

  @input
  public verbose: boolean = true;

  onAwake() {
    this.createEvent('OnStartEvent').bind(() => this.init());
  }

  private init() {
    if (!this.layout) {
      print('[ResolveButton] No ViewConeLayout reference set.');
      return;
    }
    const components = this.getSceneObject().getComponents('ScriptComponent');
    let button: any = null;
    for (let i = 0; i < components.length; i++) {
      const sc = components[i] as any;
      if (sc && sc.onTriggerUp && typeof sc.onTriggerUp.add === 'function') {
        button = sc;
        break;
      }
    }
    if (!button) {
      print('[ResolveButton] No UIKit button (onTriggerUp) found on this SceneObject.');
      return;
    }
    button.onTriggerUp.add(() => {
      if (this.verbose) print('[ResolveButton] resolve triggered');
      this.layout.refresh();
    });
    if (this.verbose) print('[ResolveButton] ready — click the button to re-resolve');
  }
}
