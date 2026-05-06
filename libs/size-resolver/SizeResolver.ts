/**
 * SizeResolver.ts — Pluggable child size detection for FlexContainer.
 *
 * Resolves the (width, height) of a SceneObject by probing its components.
 * Ships with built-in UIKit Element detection. Users can register custom
 * resolvers for their own component types.
 *
 * Priority chain:
 *   1. FlexItem explicit override (width > 0 or height > 0)
 *   2. Custom registered resolvers
 *   3. Built-in UIKit Element._size detection
 *   4. Nested FlexContainer.getContentSize()
 *   5. Fallback default (4x4 cm)
 */

var DEFAULT_SIZE = new vec2(4, 4);

type ResolverFn = (sc: any) => vec2;

var customResolvers: { name: string, fn: ResolverFn }[] = [];

export class SizeResolver {

    /**
     * Register a custom size resolver for your component type.
     *
     * The resolver function receives a ScriptComponent (as any) and should
     * return a vec2(width, height) in cm, or null if this component
     * is not the type it handles.
     *
     * Example:
     *   SizeResolver.register("MyPanel", (sc) => {
     *       if (sc.myWidth !== undefined && sc.myHeight !== undefined)
     *           return new vec2(sc.myWidth, sc.myHeight);
     *       return null;
     *   });
     */
    static register(name: string, fn: ResolverFn) {
        customResolvers.push({ name: name, fn: fn });
    }

    /**
     * Resolve the size of a child SceneObject.
     *
     * @param child The SceneObject to measure
     * @param flexItem Optional FlexItem component on the child (pre-found by caller)
     * @returns vec2(width, height) in cm
     */
    static resolve(child: SceneObject, flexItem: any): vec2 {
        // Priority 1: FlexItem explicit override
        if (flexItem) {
            var fw = flexItem.width;
            var fh = flexItem.height;
            if (fw > 0 && fh > 0) return new vec2(fw, fh);
        }

        var components = child.getComponents("ScriptComponent");

        // Priority 2: Custom registered resolvers
        for (var r = 0; r < customResolvers.length; r++) {
            for (var i = 0; i < components.length; i++) {
                var sc = components[i] as any;
                if (!sc) continue;
                try {
                    var result = customResolvers[r].fn(sc);
                    if (result) return result;
                } catch (e) {
                    // Resolver threw — skip
                }
            }
        }

        // Priority 3: UIKit Element._size (Button, Slider, Switch, etc.)
        for (var i = 0; i < components.length; i++) {
            var sc = components[i] as any;
            if (!sc) continue;
            if (sc._size !== undefined && sc._renderOrder !== undefined) {
                var sz = sc._size;
                if (sz.x > 0 && sz.y > 0) return new vec2(sz.x, sz.y);
            }
        }

        // Priority 4: Nested FlexContainer (has getContentSize method)
        for (var i = 0; i < components.length; i++) {
            var sc = components[i] as any;
            if (!sc) continue;
            if (typeof sc.getContentSize === "function" && typeof sc.layout === "function") {
                sc.layout(); // depth-first: compute inner layout first
                return sc.getContentSize();
            }
        }

        // Priority 1 partial: FlexItem has one dimension set
        if (flexItem) {
            var w = flexItem.width > 0 ? flexItem.width : DEFAULT_SIZE.x;
            var h = flexItem.height > 0 ? flexItem.height : DEFAULT_SIZE.y;
            return new vec2(w, h);
        }

        // Priority 5: Fallback
        return DEFAULT_SIZE;
    }
}
