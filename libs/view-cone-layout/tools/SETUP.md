# ViewCone live-streaming setup

This is the recipe for taking an empty Lens Studio Spectacles project and
giving it a working web preview: every frame the lens renders is JPEG-encoded
and broadcast on a Snap Cloud (Supabase Realtime) channel, then a small
browser viewer subscribes and draws it on a canvas. The viewer also shows the
**Spectacles view zone** at its true aspect; whatever extra environment the
LS editor renders outside that zone is visible to the side, exactly the way
the editor presents it.

The setup is built from very specific pieces. The `tools/viewcone-mcp.py`
super-commands automate the parts that are pure scene-graph plumbing; the
parts that actually need a human in Lens Studio are flagged below.

---

## What's involved (the moving parts)

```
┌────────────────────────────────────── Lens Studio project ───────────────────────────────────┐
│                                                                                              │
│  Packages/                                                                                   │
│    SupabaseClient.lspkg          ← Snap Cloud realtime client (signInWithIdToken,            │
│                                    .channel('…').on('broadcast').subscribe(…))               │
│                                                                                              │
│  Assets/                                                                                     │
│    CompositeCameraTexture.lspkg/                                                             │
│      CompositeImage__PLACE_IN_SCENE.prefab  ← drag into scene; sets up VirtRender +          │
│                                                ImageBackground + ImageVirtContent            │
│      Render/CompositeImage.renderTarget     ← composite RT (camera + lens), what we stream   │
│      Materials/ImageCI.mat, ImageVC.mat, ImageB.mat                                          │
│                                                                                              │
│    SupabaseProject main.supabaseProject  ← created via Window > Supabase > Import Credentials│
│    Render Target.renderTarget            ← lens RT (the lens itself draws into this)         │
│                                                                                              │
│    Scripts/SnapCloudRequirements.ts      ← holds the SupabaseProject reference centrally     │
│    Streaming/LayoutPreviewStreamer.ts    ← attaches Base64.encodeTextureAsync → broadcast    │
│                                                                                              │
│  Scene (top → bottom; LS renders top to bottom):                                             │
│    CompositeImage                              (Layer 1 visual + Layer 2 sub-camera)         │
│      ├─ VirtRender   Camera renderLayer=2 → writes to lens RT                                │
│      │   └─ Object 0/                                                                        │
│      │       ├─ ImageVirtContent  RenderMeshVisual (ImageVC.mat textured w/ lens RT)         │
│      │       ├─ ImageBackground   RenderMeshVisual (ImageB.mat w/ background)                │
│      │       └─ Instructions      Text                                                       │
│      └─ CompositeImage Image  RenderMeshVisual (ImageCI.mat textured w/ composite RT)        │
│    <your virtual content here, all on Layer 2>                                               │
│    Streaming                                                                                 │
│      ├─ ScriptComponent: SnapCloudRequirements   (.supabaseProject ← asset)                  │
│      └─ ScriptComponent: LayoutPreviewStreamer   (.snapCloudRequirements ← above             │
│                                                   .compositeTexture ← composite RT           │
│                                                   .lensTexture ← lens RT                     │
│                                                   .channelName = "viewcone-live-stream")     │
│    Camera Object  ← MUST be the LAST top-level object                                        │
│      ├─ Camera        renderLayer=1 (deviceProperty=All), writes to lens RT                  │
│      └─ DeviceTracking                                                                       │
│                                                                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │  composite-stream-init
                                       │  composite-stream-started
                                       │  composite-video-frame  (base64 JPEG, ~15 fps)
                                       │  composite-stream-ended
                                       ▼
                           Supabase Realtime channel
                              "viewcone-live-stream"
                                       │
                                       ▼
┌────────────────────────────── Web viewer (demo/public/preview.html) ─────────────────────────┐
│  • Subscribes via @supabase/supabase-js                                                      │
│  • Decodes each JPEG → drawImage onto <canvas>                                               │
│  • object-fit: contain  → letterboxes to source aspect, never stretches                      │
│  • Wrap is resizable (CSS resize: both)                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Pre-conditions you have to handle in Lens Studio

These cannot be done over MCP — Lens Studio must be open and you do them
through the UI:

1. **Open the project** in Lens Studio (the MCP server starts automatically;
   you'll see it on a port like 8731).
2. **Snap Cloud / Supabase plugin** installed and logged in
   (Window > Supabase). If the menu isn't there, install the plugin first.
3. **SupabaseProject asset**: Window > Supabase > Import Credentials. This
   creates a `…supabaseProject` asset in `Assets/` carrying the project URL
   and anon token. The streamer reads from it via `SnapCloudRequirements`.
4. **CompositeCameraTexture.lspkg** present under `Assets/`. Get it from the
   official "Composite Camera Texture" sample on the Spectacles dev site and
   drop the `.lspkg` folder into `Assets/`.
5. **SupabaseClient.lspkg** present under `Packages/`. Snap Cloud installs
   this automatically when you import credentials; double-check.
6. The two scripts in this repo, deployed to the project:
   `Assets/Scripts/SnapCloudRequirements.ts`,
   `Assets/Streaming/LayoutPreviewStreamer.ts`. They're already there in
   our checked-in project; if you're recreating the setup elsewhere, copy
   them over.

If any of the above is missing, `viewcone-mcp.py check` will tell you so
with a one-line explanation per item.

---

## The super-commands (what `tools/viewcone-mcp.py` actually does)

```
viewcone-mcp.py check        # diagnose: lists missing files, scene objects, wiring
viewcone-mcp.py composite    # InstantiateLensStudioPrefab on CompositeImage prefab
viewcone-mcp.py streaming    # CreateLensStudioSceneObject "Streaming" + 2 ScriptComponents
viewcone-mcp.py wire         # SetLensStudioProperty: Supabase ref, channel, RTs
viewcone-mcp.py layers <name> --layer 2   # assign Layer 2 to a subtree
viewcone-mcp.py setup        # check → composite → streaming → wire → re-check
viewcone-mcp.py list-ports   # probe likely LS MCP ports and report which are reachable
```

`--port <n>` overrides MCP port; otherwise the script auto-detects by
probing `[8731, 8733, 8732, 8730]` and preferring the LS instance whose
scene contains "ViewCone" somewhere.

The script is idempotent: re-running `composite` won't double-instantiate;
re-running `streaming` won't duplicate ScriptComponents; `wire` overwrites
references with the current targets.

### What each super-command does in MCP terms

| super-command | MCP tools called                                           |
|---------------|------------------------------------------------------------|
| `check`       | `GetLensStudioSceneGraph`, `GetLensStudioSceneObjectByName`, `GetLensStudioAssetsByName` |
| `composite`   | `GetLensStudioSceneObjectByName`, `InstantiateLensStudioPrefab` |
| `streaming`   | `CreateLensStudioSceneObject`, `CreateLensStudioComponent` (×2) |
| `wire`        | `GetLensStudioAssetsByName`, `SetLensStudioProperty` (×3+)  |
| `layers`      | `GetLensStudioSceneObjectByName`, walk + `SetLensStudioProperty` |

### Warnings the script will print

- **Missing on disk**: `SupabaseClient.lspkg`, `CompositeCameraTexture.lspkg`,
  the streamer script, or `SnapCloudRequirements.ts`.
- **No SupabaseProject asset** → "Create via Window > Supabase > Import
  Credentials in Lens Studio."
- **`Camera Object` not at the bottom of the hierarchy** → must be last so
  the lens RT is filled before the lens camera reads it. The script does
  *not* auto-reparent the Camera Object — moving it via MCP has crashed
  Lens Studio in the past.
- **No `Streaming` SceneObject** → run `streaming`.
- **Streaming has zero ScriptComponents** → run `streaming` (will attach
  the two scripts).
- **Could not unambiguously identify** the SnapCloudRequirements vs.
  Streamer ScriptComponents during `wire` → drag references manually in LS.
- **Composite RT or Lens RT not found by name** → the asset may have been
  renamed; pass the right asset id via the LS UI.

---

## Manual finishing touches (LS will fight you on these)

A few invariants the script does not try to enforce, because attempting them
through MCP has been unreliable on past sessions:

1. **`Camera Object` must be the last top-level object.** LS renders top to
   bottom; everything that *writes* to a render target needs to come before
   the camera that *reads* it. Drag it to the bottom in the Hierarchy panel.
2. **All your virtual content must be on Layer 2.** The VirtRender camera
   (inside CompositeImage) only renders Layer 2 into the lens RT.
   `viewcone-mcp.py layers MyContent` does this for a subtree. The lens's
   main Camera should stay on Layer 1.
3. **Cameras need `deviceProperty: All`** for stereo/Spectacles mode.
   New Camera components default to `None` — set it to `All` in the
   Inspector or via `SetLensStudioProperty deviceProperty=1`.
4. **Composite RT must be 2:3 portrait — `900 × 1350`.** Spectacles per-eye
   native aspect is 2:3 (W/H ≈ 0.667). The default `CompositeImage.renderTarget`
   ships at `900 × 900` (square), which produces a stretched lens render in
   the composite chain. Either set the asset's `Width × Height` to
   `900 × 1350` *or* tick `Use Screen Resolution` and resize the LS Lens View
   panel to a 2:3 portrait shape. The web viewer
   (`demo/preview.html`) has the 2:3 ratio hard-coded and crops every JPEG
   centre-out to that aspect — match the RT and the rendered content lines
   up 1:1 with the in-LS preview.
5. **`Transform.forward` returns local +Z**, but the camera renders along
   −Z. Code that wants the rendering direction must use
   `cameraTr.forward.uniformScale(-1)`. Both `ConeProjector.ts` and
   `ViewConeLayout.ts` already do this; mention it here so it doesn't bite
   anyone re-implementing.

---

## Walkthrough: from clean project to live frame in the browser

```bash
# 0. (in Lens Studio) open the project; install Snap Cloud plugin;
#    Window > Supabase > Import Credentials (creates SupabaseProject asset).

# 1. (in shell) verify everything the script needs is on disk and reachable.
./tools/viewcone-mcp.py check

# 2. drop the composite prefab into the scene.
./tools/viewcone-mcp.py composite

# 3. create the Streaming SceneObject and attach the two scripts.
./tools/viewcone-mcp.py streaming

# 4. wire SupabaseProject + textures + channel name into the Streamer.
./tools/viewcone-mcp.py wire --channel viewcone-live-stream

# 5. (in LS) drag Camera Object to the bottom of the hierarchy.
#    (in LS) make sure your virtual slots are on Layer 2:
./tools/viewcone-mcp.py layers MySlots --layer 2

# 6. start the dev server for the viewer (separate terminal).
cd demo && npm run dev   # serves http://localhost:4322

# 7. capture proof.
node demo/test/screenshot-viewer.mjs   # full page incl. chrome
node demo/test/screenshot-frame.mjs    # canvas pixels only
```

The viewer shows live frames at ~9 fps once the scene actually streams.
If status sticks at "Subscribed — waiting for frames", the streamer either
isn't auth'd to Snap Cloud (check the LS console for
`[LayoutPreviewStreamer] Snap Cloud auth ok`) or the channel name doesn't
match between LS and the browser.

---

## Agentic loop: web → LS UI intents

LS Editor exposes no pointer-injection API. To drive an LS-side action from
the web (or any external code) without OS-level mouse hacks, the project
routes named intents over the same Supabase channel that streams frames,
plus a tiny global registry on the LS side that decouples the listener
from the action's owner — no scene-graph wiring.

```
Web                                       LS
───                                       ──
ch.send({event:'ui-trigger',    ─────►    SlotStateBroadcaster.applyTrigger
         payload:{target:'resolve'}})     └── fireRemoteTrigger('resolve')
                                              ↓ (global registry lookup)
                                              ViewConeLayout.refresh()
                                              (registered itself in onAwake)
```

### Built-in remote triggers

`LayoutPreviewStreamer` and `ViewConeLayout` self-register the following on
`onAwake`. Web sends `{event:'ui-trigger', payload:{target:'<name>'}}`.

| target | what it does |
|--------|--------------|
| `snapshot`        | one JPEG frame on demand (default mode — keeps quota near zero) |
| `stream-start`    | turn continuous streaming ON (uses `fps` setting) |
| `stream-stop`     | turn continuous streaming OFF |
| `resolve`         | run `ViewConeLayout.refresh()` (angular-space layout pass) |
| `reset`           | restore every slot to its authored "before" position |
| `text-shrinkwrap` | (dev-only, behind `?dev=1` in the web) reapply Wrap + Shrink overflow on every Text in the slot tree |
| `text-autofit`    | (dev-only, behind `?dev=1` in the web) rescale every Text's `size` so its on-display cap height = `TextAutoFit.targetPx` |

**Per-instance trigger names.** `ViewConeLayout` has an `actionName`
input (default `"resolve"`). Override it (e.g. `"resolve-uikit"`) to run
multiple layouts side-by-side; the matching reset trigger is
`<actionName>-reset`.

### Mesh-agnostic projection (BoundsSlot — in-LS only for now)

`ConeProjector.projectObjectAabb(obj)` aggregates the world AABB of every
`BaseMeshVisual` in `obj`'s subtree, projects all 8 corners to angular
space, and returns the bounding angular rect.
`ViewConeLayout.projectAll()` calls this first; it falls back to the
authored `width/height` path only if no mesh is found.

`Layout/BoundsSlot.ts` is the marker script for objects without an
authored panel size — drop it on any SIK button, Frame, Image, custom
mesh, etc., set its `priority` / `sector` / `depthLane` hints, and the
resolver treats it the same as a `ConeSlot`.

> **Status.** The AABB path is wired but unverified for SIK runtime
> visuals (RoundedRectangleVisual etc. create child SceneObjects at
> `OnStartEvent`, which races with `ViewConeLayout.init()`). Validate
> in-LS first — the diagnostic `print` in `ViewConeLayout.refresh()`
> dumps each entry's projected angular rect, so you can confirm meshes
> are found before exposing the resolver to UIKit content from the web.

The streamer's `continuous` input defaults to **false** — no JPEGs leave LS
until something fires `snapshot` or `stream-start`. Snapshot mode is the
right default for an agentic loop where the layout doesn't change frame by
frame.

### Registry API — `Assets/Streaming/RemoteTriggers.ts`

```ts
import { registerRemoteTrigger, fireRemoteTrigger } from '../Streaming/RemoteTriggers';

// Anywhere a script owns a remote-callable action:
registerRemoteTrigger('resolve',   () => this.refresh());
registerRemoteTrigger('reset',     () => this.resetPositions());

// SlotStateBroadcaster on inbound ui-trigger:
fireRemoteTrigger(payload.target);   // returns false if no handler
```

The broadcaster needs no `@input` reference to the action's owner. New
actions = add `registerRemoteTrigger(name, fn)` in the owner's `onAwake`
plus a button (or any code) on the web that sends
`{event:'ui-trigger', payload:{target:name}}`.

Web side: `demo/preview.html` has a "Resolve (LS)" button next to
Connect/Disconnect. From your own JS:

```js
channel.send({
  type: 'broadcast',
  event: 'ui-trigger',
  payload: { target: 'resolve' },
});
```

Combined with the slot-state snapshots already on the channel, this is the
full read-decide-act loop: read `cone-slots-state` → run agent logic → send
`ui-trigger`. No mouse, no editor scripting, no SIK plumbing.

---

## Files to know

```
libs/view-cone-layout/
  ViewConeLayout/
    Assets/
      Scripts/SnapCloudRequirements.ts       # holds the SupabaseProject ref
      Streaming/LayoutPreviewStreamer.ts     # the actual streamer
      Layout/{ConeProjector,ConeSlot,ViewConeLayout}.ts
      CompositeCameraTexture.lspkg/          # the composite prefab + materials + RT
      SupabaseProject main.supabaseProject   # generated asset
      Render Target.renderTarget             # lens RT
    Packages/SupabaseClient.lspkg            # Snap Cloud client lib
  demo/
    public/preview.html                      # browser viewer
    test/screenshot-viewer.mjs               # puppeteer: full page screenshot
    test/screenshot-frame.mjs                # puppeteer: canvas pixels only
    test/check-layout.mjs                    # puppeteer: viewport-fit regression
  tools/
    viewcone-mcp.py                          # super-commands CLI (this doc)
    SETUP.md                                 # this file
```
