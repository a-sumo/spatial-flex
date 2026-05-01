# view-cone-layout

Frustum-based spatial layout with overlap resolution for Lens Studio / Snap Spectacles.

Part of [`spatial-flex`](../..).

When you place panels in 3D space in front of the user, two panels at different depths can look fine in the editor and overlap completely from the wearer's point of view. `view-cone-layout` projects every panel into the user's angular space (azimuth and elevation), detects camera-perspective overlaps, and resolves them by pushing panels apart along the cheaper axis.

## Demo

![view-cone-layout screenshot](media/screenshot.png)

The four colored panels are placed in 3D space; the inset bottom-right shows what the user actually sees through Spectacles; the bottom-left log lists which pairs overlap from that point of view. Hit `Resolve Overlaps` and the panels separate in real time.

To run the demo locally:

```bash
cd demo
npm install
npm run dev
```

Open http://localhost:5180.

## Install

Drag the three `.ts` files (and their `.meta` siblings) into your Lens Studio project's `Assets/`:

```
YourProject/
  Assets/
    view-cone-layout/
      ViewConeLayout.ts
      ViewConeLayout.ts.meta
      ConeProjector.ts
      ConeProjector.ts.meta
      ConeSlot.ts
      ConeSlot.ts.meta
```

## Usage in Lens Studio

Attach `ViewConeLayout` to a parent SceneObject. Add a `ConeSlot` component to each child you want laid out. The layout component reads each slot's intended position, projects the bounds into angular space using `ConeProjector`, and writes back resolved positions that no longer overlap from the camera's view.

## How it works

1. **Project**: each slot's world bounds are projected to angular coordinates `(az, el)` and a depth.
2. **Detect**: pairwise rectangle overlap test in angular space.
3. **Resolve**: for every overlapping pair, compute the overlap on each axis. Push along the axis with smaller overlap (cheaper resolution). Iterate until no overlaps remain or a max-iterations cap is hit.

This runs cheaply because the math is rectangle-vs-rectangle in 2D; you can call it on every panel position change without breaking frame budget.

## License

MIT.
