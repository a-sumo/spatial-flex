# spatial-flex

Drop-in spatial UI primitives for Lens Studio / Snap Spectacles.

Each package is a single folder you drag into your project's `Assets/`. No build step, no package manager, no version resolver. Just files. Mix and match — most packages have zero dependencies, and the few that don't say so up front.

## Packages

| Package | What it does | Deps |
| --- | --- | --- |
| [`text-reflow`](packages/text-reflow) | Word-wrap and text-metrics engine. Wraps to width, auto-shrinks to fit, flows around circular obstacles. Pure arithmetic — runs cheap every frame. | none |
| [`size-resolver`](packages/size-resolver) | Pluggable registry that lets a layout container ask "how big is this child?" without hard-coding every possible component type. | none |

## Install

Each package is self-contained. Drag the package folder (or just the `.ts` + `.meta` files inside it) into your Lens Studio project's `Assets/` directory.

```
YourProject/
  Assets/
    text-reflow/
      TextLayout.ts
      TextLayout.ts.meta
    size-resolver/
      SizeResolver.ts
      SizeResolver.ts.meta
```

Then import in any script:

```ts
import { TextLayout } from './text-reflow/TextLayout';
import { SizeResolver } from './size-resolver/SizeResolver';
```

If you only want one of them, take only that folder. If you put them in subfolders, adjust the relative path.

## Why "spatial-flex"

Building UI on Spectacles means thinking about layout in 3D space, with no DOM, no canvas, no `measureText()`, and a runtime that's stricter than a browser. The pieces here are the primitives we kept reaching for: text that reflows responsively, containers that detect child sizes without hard imports, and the small kernels that make either of those possible.

The name signals the scope. This repo is for **layout, sizing, and flexible spatial composition**. Heavier visual primitives — procedural meshes, GPU-deformed tubes, shader templates — live in their own repos.

## Status

Early. We're seeding this with the pieces we've battle-tested in production lenses; expect the catalog to grow as more get extracted. Issues and PRs welcome.

## License

MIT for everything in this repo.

## Maintained by

[Curvilinear](https://github.com/curvilinear-space) — navigation infrastructure for the age of AI.
