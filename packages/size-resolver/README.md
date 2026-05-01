# size-resolver

A pluggable child-size detection registry for Lens Studio / Snap Spectacles layout containers.

Part of [`spatial-flex`](../..) — drop-in spatial UI primitives.

When you build a layout container that arranges its children, you need to know how big each child is. But children can be anything: a `Component.Text`, a UIKit Button, a custom `@component`, another nested container. `SizeResolver` is a tiny registry that lets you ask "what's this child's computed size?" without hard-coding every possible answer.

## Install

Drag `SizeResolver.ts` into your Lens Studio project's `Assets/` folder.

```ts
import { SizeResolver } from './SizeResolver';
```

## Quick start

```ts
import { SizeResolver } from './SizeResolver';

// In your layout container, for each child:
const size = SizeResolver.resolve(childSceneObject, flexItemComponent);
// size.x = width in cm, size.y = height in cm
```

The resolver walks a priority chain and returns the first match:

1. **`FlexItem` explicit override** — if a `FlexItem` is passed and has `width > 0` and `height > 0`, those values win
2. **Custom registered resolvers** — anything registered via `SizeResolver.register()`
3. **UIKit Element detection** — duck-typed via `_size` and `_renderOrder` (matches Button, Slider, Switch, etc.)
4. **Nested layout containers** — any component with `getContentSize()` and `layout()` methods
5. **Fallback** — `vec2(4, 4)` cm

## Registering a custom resolver

If you have your own `@component` that exposes a computed size, register a resolver so any `spatial-flex` container can pick it up:

```ts
SizeResolver.register("MyPanel", (sc) => {
  if (sc.myWidth !== undefined && sc.myHeight !== undefined) {
    return new vec2(sc.myWidth, sc.myHeight);
  }
  return null;  // not my component, try the next resolver
});
```

The function is called with each `ScriptComponent` on the child object. Return `null` if it's not your type — return a `vec2` if it is. Resolvers that throw are silently skipped, so you don't need defensive code for components that lack the fields you expect.

This is how `text-reflow`'s `FlexText` component, `flex-container`, and any future package register themselves: zero hard imports, zero coupling.

## Why duck-type instead of `instanceof`?

Lens Studio scripts can't reliably do `instanceof` checks across packages because each script is its own asset import. Duck-typing on field/method shape is the only pattern that lets a layout container detect a child component from a different package without taking a hard import dependency on it.

## License

MIT.

## Credits

Maintained by [Curvilinear](https://github.com/curvilinear-space).
