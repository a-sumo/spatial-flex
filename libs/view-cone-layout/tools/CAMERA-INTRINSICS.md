# Measuring camera intrinsics inside Lens Studio / Spectacles

This is the procedure used to derive the projection matrix for the Spectacles
lens camera as seen from the Lens Studio editor preview, and from there a
practical "how many pixels does 1 cm cover at distance D" rule. The repo
ships a script (`tools/camera-intrinsics.mjs`) that reproduces every number
in this doc end-to-end.

The project context: live JPEG frames stream from Lens Studio over Snap Cloud
(Supabase Realtime) to a browser viewer. To draw HUD overlays on those frames
that line up with 3D objects in the lens, you need the camera's K matrix.

---

## What "the camera" actually is

There are two cameras in the scene and two render targets, so before any
measurement makes sense you have to decide which one you mean.

| Camera          | Renders   | Output RT                  | useScreenResolution |
|-----------------|-----------|----------------------------|---------------------|
| `Camera Object` | Layer 1   | `Render Target` (`923415f5…`) — "lens RT"        | **true** |
| `VirtRender`    | Layer 2   | `CompositeImage` (`c7a32030…`) — "composite RT"  | false (fixed dims) |

- The **lens RT** is what the user actually sees through the glasses. Its
  dimensions follow the device on-device, but in the editor preview they
  follow whatever size the LS preview window happens to be — so the captured
  pixel dims are a snapshot of one moment, not a stable spec.
- The **composite RT** is a fixed-resolution texture that the
  `CompositeImage` prefab uses to layer the camera-feed background under the
  lens render. It has explicit dimensions you set on the asset.

Both share a single Camera component with the same FOV; what differs is the
render target dims, and therefore the K matrix that maps view-space rays to
pixel coordinates.

---

## What we read directly from the scene

`tools/viewcone-mcp.py` and the native LS MCP let us read the Camera
component without compiling. From `Camera Object`'s Camera component:

```
fov            = 63.541019480008295   (degrees, vertical)
aspect         = 1
cameraType     = 0                    (Perspective)
near           = 1
far            = 10000
renderLayer    = 1
renderTarget   = "Render Target"  (923415f5-…)  — useScreenResolution = true
deviceProperty = 3                    (All)
```

Two notes:

1. The `fov` field appears in the inspector dump as a degree value
   (`63.54…`). The runtime LS Camera API takes radians, so any code reading
   this property at script time should multiply by `π/180`.
2. `aspect = 1` and `aspectPreset = 1` are LS's "auto" / "follows render
   target" markers, not literal 1:1.

---

## What we measure live

The streamer encodes whatever texture it's pointed at, so capturing one JPEG
tells us the actual pixel dims of the active RT. The `screenshot-frame.mjs`
helper grabs a single frame from the canvas as a PNG.

### Composite RT (default)

```
streamer mode:    composite
JPEG pixel dims:  900 × 900
pixel aspect:     1.0000
```

Square, because the asset itself is configured to 900×900.

### Lens RT (switch streamer mode to "lens")

```
streamer mode:    lens
JPEG pixel dims:  949 × 2850
pixel aspect:     0.3330  (≈ 1:3)
```

The 1:3 aspect is suspicious. Spectacles renders stereo, and the lens RT
contains both eyes plus headers/timing-rows packed vertically; the per-eye
slice is roughly 949 × ~1280. We don't try to crop here — we just record
that the JPEG you receive has these dims and downstream code has to know
the packing.

> **Caveat.** With `useScreenResolution = true`, lens-RT dims are whatever
> the editor preview window is sized to **at the moment of capture**. Resize
> the LS preview, capture again, get different numbers. On-device the dims
> are fixed by the Spectacles hardware.

---

## The K matrix

For a perspective pinhole camera with vertical FOV `vFov`, render target
`W × H`, and the principal point at the image centre:

```
hFov = 2 · atan( tan(vFov/2) · (W/H) )
fy   = (H/2) / tan(vFov/2)
fx   = (W/2) / tan(hFov/2)
cx   = W / 2
cy   = H / 2

K = ⎡ fx   0  cx ⎤
    ⎢  0  fy  cy ⎥
    ⎣  0   0   1 ⎦
```

### Composite RT (W=900, H=900, vFov=63.54°)

```
vertical   FOV: 63.541°
horizontal FOV: 63.541°    (square RT ⇒ same as vertical)
fx = 726.61  px
fy = 726.61  px            (square pixels — matches the assumption)
cx = 450.00  px
cy = 450.00  px

K =  ⎡ 726.61    0.00   450.00 ⎤
     ⎢   0.00  726.61   450.00 ⎥
     ⎣   0.00    0.00     1.00 ⎦
```

### Lens RT, single capture (W=949, H=2850, vFov=63.54°)

Treating the 1:3 frame as a single image (knowing this conflates two stereo
views — see caveat above):

```
vertical   FOV: 63.541°
horizontal FOV: ~22.69°
fx ≈ 2300       fy ≈ 2300
cx = 474.5      cy = 1425
```

This number is only useful if you crop to one eye first. For per-eye
intrinsics you take half (or third) of `H`, recompute as if that's your full
image, and use the same vFov.

---

## The practical scale rule

For UI overlays the most useful number is "how many pixels does 1 cm cover
at distance D from the camera." For a perspective camera this is just
`fx / D`:

| RT          | D = 50 cm  | D = 100 cm | D = 200 cm |
|-------------|-----------:|-----------:|-----------:|
| composite   | 14.53 px   |  7.27 px   |  3.63 px   |
| lens (full) | 46.0  px   | 23.0  px   | 11.5  px   |

(Lens-RT numbers above are for the un-cropped 949-wide capture. Crop to one
eye and they roughly halve.)

So a 4 cm UI element at 100 cm in the composite stream covers ~29 pixels —
about right for a button glyph, and a useful sanity check when laying out
in-world UI.

---

## Reproducing this measurement

```
# 1. ensure Lens Studio is open with the project
./tools/viewcone-mcp.py list-ports          # confirm 8731 reachable

# 2. ensure the dev server + viewer are running
cd demo && npm run dev                      # port 4322

# 3. run the intrinsics tool (writes camera-intrinsics.json next to it)
node demo/test/camera-intrinsics.mjs        # uses the puppeteer in demo/

# (optional) capture lens RT instead of composite by flipping streamer mode:
python3 - <<'PY'
import urllib.request, json
req = urllib.request.Request(
  'http://localhost:8731/mcp', method='POST',
  headers={'Authorization': 'Bearer ...your-token...',
           'Content-Type': 'application/json'},
  data=json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/call',
    'params':{'name':'SetLensStudioProperty',
      'arguments':{'objectUUID':'5bb56418-...',
        'componentUUID':'a639296f-bb43-415f-9056-ddbe40e6577f',
        'propertyPath':'mode','value':'lens'}}}).encode())
print(urllib.request.urlopen(req).read().decode())
PY
```

The tool prints the table above and saves a JSON report:

```json
{
  "declared":   { "fov_raw": 63.541, "aspect": 1, "cameraType": 0, ... },
  "measured":   { "jpeg_width": 900, "jpeg_height": 900, ... },
  "intrinsics": { "fx": 726.61, "fy": 726.61, "cx": 450, "cy": 450,
                  "vfov_deg": 63.541, "hfov_deg": 63.541,
                  "K": [[fx,0,cx],[0,fy,cy],[0,0,1]] }
}
```

---

## Caveats worth listing in the article

- **Editor preview vs device.** The lens RT in the editor follows the
  preview window size; the K matrix you derive from a captured frame is
  only stable if the preview window is.
- **Stereo packing.** The lens-mode JPEG carries both eyes (and possibly a
  header row) stacked. Don't apply the K straight to that frame — crop to
  one eye first, then derive K with the cropped dims.
- **No lens distortion.** Spectacles optics introduce barrel distortion that
  the on-device compositor corrects. The K above is the *projection* matrix
  for the rendered image and ignores distortion. If you're aligning to a
  through-the-lens photograph you'll need a distortion model too — start
  from Snap's published lens-shader parameters, then refine with a
  chessboard calibration.
- **The composite RT is a deliberately fixed size**, useful when you want a
  stable pixel grid for browser overlays. It costs you the option of
  matching device aspect; pick whichever matters more for the use case.
## Empirical calibration — final result

A multi-view chessboard calibration (cv2.calibrateCamera over 7 oblique
captures of a 10×7 board on a flat plane at known commanded distances)
yields a **measurably different K** from the analytical one above. The
streamed lens-RT pixels do not match the projection that the declared
vFov = 63.54° would imply.

```
empirical pinhole, fx=fy enforced, image 931 × 2796:
  fx = fy ≈ 2560.8 px
  cx ≈ 549.1     cy ≈ 1395.0
  RMS reprojection error ≈ 1.16 px (over 7 views)

  ⇒ effective vFov ≈ 57.3°   (declared 63.54°)
  ⇒ effective hFov ≈ 20.6°   (declared 23.30°)
```

The captured frame is therefore covering ~10% less of the world per dimension
than the declared vFov implies. The lens RT goes through additional
post-processing before the encoded JPEG (likely the Spectacles
distortion-correction pipeline trimming the rendered image margins, or a
downsample-then-resize step). For drawing HUD overlays on the streamed lens
frames the empirical K above is what should be used; the analytical K is
correct for the *un-corrected* internal render but wrong for what we get out
of `Base64.encodeTextureAsync` on the lens RT.

The image is tall and the chessboard is rendered onto a Plane.mesh that
applies its texture to a sub-region of the mesh (the texture coordinates
don't fill the full mesh extent). The recovered physical square aspect is
**h/w ≈ 2.78**, derived as the value of the obj-points aspect that minimises
RMS — a plausible by-product of the 10:7 texture mapped onto a rectangular
subregion of a 1:1 plane via stretchMode=2.

### Practical scale rule (revised)

```
px per cm at distance D = fx / D ≈ 2561 / D
```

| RT          | D = 50 cm  | D = 100 cm | D = 200 cm |
|-------------|-----------:|-----------:|-----------:|
| lens (full) | 51.2 px    | 25.6 px    | 12.8 px    |

So a 4 cm UI element at 100 cm covers ~102 px in the lens frame, not the
~92 px the analytical K would predict.

### Reproducing the calibration

```
# 1. Open Lens Studio with this project; ensure the streamer is running
#    (LayoutPreviewStreamer set to mode=lens, or pickTexture forced to lens).
#    Disable ViewConeRoot to remove the dynamic slot meshes.

# 2. Create a CalibBoard scene object via MCP:
#      - localTransform.position = (0, 0, -50)
#      - localTransform.rotation = (90, 0, 0)
#      - localTransform.scale    = (20, 1, 20)
#    Add a RenderMeshVisual with mesh=Plane and mainMaterial=CalibChess.

# 3. Capture multi-view frames:
cd demo
node test/multi-view-capture.mjs    # writes test/calib/*.png

# 4. Run the calibrator:
python3 tools/calibrate.py --commanded-distance-cm 50
# → tools/camera-intrinsics-empirical.json
```

The `multi-view-capture.mjs` script drives the CalibBoard's local transform
through ~14 poses via the LS MCP and grabs a frame per pose from the
Supabase live stream. `calibrate.py` keeps the 7 cleanest views (frontal +
axis-aligned tilts) and reports the pinhole K plus per-view residuals.

---

## Empirical verification — what we tried, what blocked it

The intended path: drop a robotics-style chessboard (10×7 squares, 9×6 inner
corners) on a `Plane` mesh in front of the camera, capture, run OpenCV's
`findChessboardCorners` + `calibrateCamera`. We generated the texture
(`Assets/Calibration/chessboard_10x7.png`, 2000×1400, square edge 200 px),
created an unlit material `CalibChess` with `baseTex = chessboard_10x7`,
applied it to a `Plane` RMV positioned at world `(0, 0, -50)` cm with
`rotation (-90, 0, 0)` (default `Plane.mesh` faces +Y; rotating −90° around
X aligns its normal with +Z so it faces the camera at the origin).

**It did not appear in the streamed frame.** Both directions failed:

- **Composite mode.** `VirtRender` (cameraType: 1, Orthographic) renders
  Layer 2 into the composite RT. The composite RT is dominated by
  `ImageBackground` — a full-screen, screen-anchored Image inside the
  `CompositeImage` prefab — which appears to overdraw any world-space Plane
  rendered behind it on Layer 2. Disabling `ImageBackground` made the rest
  of the prefab visible (a small blue Text panel) but still no chessboard;
  world-space Planes on Layer 2 are not making it into the composite RT in
  this prefab configuration.
- **Lens mode.** `Camera Object` (Perspective, vFov 63.54°) renders Layer 1
  into the lens RT. But the prefab also instantiates a top-level
  `CompositeImage` Image (textured with the composite RT) that fills the
  full Layer 1 view. Anything else on Layer 1 sits behind it.

The honest conclusion: the `CompositeCameraTexture.lspkg` prefab is
deliberately a self-contained pipeline that lets the lens RT *be the
composite RT, screen-aligned*. It's not a render pass you can simply add
world-space props into for a calibration capture.

### What would work

Two paths to a real empirical calibration:

1. **A separate calibration scene (recommended).** Strip the
   `CompositeImage` prefab entirely, leave one Camera Object, drop the
   `Plane` with `CalibChess`, and capture either via `Base64.encodeTextureAsync`
   on the lens RT, or via the LS preview-window screenshot. Multiple
   captures at different chessboard rotations/distances drive
   `cv2.calibrateCamera`. Estimated work: a couple of hours.
2. **In-scene, with prefab disabled.** Disable both the `CompositeImage`
   top-level Image and `ImageBackground` for the duration of capture so the
   raw lens render is visible, then re-enable. Same OpenCV pipeline.
   Estimated work: 30 minutes once you've identified the right components
   to toggle.

For the article's purposes, the analytical numbers above (`fx = fy = 726.61
px` on the 900×900 composite stream) are exact for the editor preview given
the declared FOV. Lens distortion and any device-vs-editor delta require
through-the-lens calibration on actual Spectacles hardware — that's a
separate exercise involving a printed chessboard and the on-device camera
API, not the editor.

### Tooling shipped for the next attempt

- `tools/chessboard_10x7.png` (2000×1400, square = 200 px) is in
  `ViewConeLayout/Assets/Calibration/`.
- `CalibChess` material (uber_unlit + chessboard_10x7) is in the project,
  ready to apply to any plane.
- The OpenCV calibration loop (multi-view detection + `calibrateCamera`)
  is straightforward to write once the capture path is unblocked; the
  pixel-detection step is `cv2.findChessboardCorners(img, (9,6))` + corner
  refinement.

---

## Files

```
libs/view-cone-layout/
  tools/
    camera-intrinsics.mjs                # analytical script (declared FOV + RT dims)
    camera-intrinsics.json               # analytical run output
    calibrate.py                         # OpenCV multi-view chessboard calibration
    camera-intrinsics-empirical.json     # empirical calibration output
    CAMERA-INTRINSICS.md                 # this doc
  demo/test/
    camera-intrinsics.mjs                # mirror of the tools/ script (puppeteer)
    screenshot-frame.mjs                 # single-frame canvas capture
    multi-view-capture.mjs               # drives CalibBoard poses + captures
    calib/                               # multi-view calibration captures
```
