#!/usr/bin/env python3
"""OpenCV multi-view chessboard calibration of the Lens-RT preview camera.

Procedure
---------
1. With Lens Studio open and the streamer routed to the lens RT (perspective
   camera), capture multiple views of a 10×7 chessboard using
   ``demo/test/multi-view-capture.mjs``. Each capture is saved under
   ``demo/test/calib/POSE.png``.
2. Run this script. It reads every PNG, detects the 9×6 inner-corner grid,
   sweeps the chessboard square aspect to find the value that minimises
   reprojection error (the texture is mapped onto a non-square plane so
   the physical squares are rectangular), then runs cv2.calibrateCamera
   on a curated subset of the cleanest views.

Why a subset
------------
With highly rectangular squares (h:w ≈ 2.8) the chessboard has near-symmetric
projections under in-plane (Z) rotations. cv2.findChessboardCorners can flip
the row/col interpretation, biasing the calibration. The subset here drops
Z-rotated and extreme oblique combos and keeps frontal + axis-aligned tilts.
"""
import argparse, glob, json, os, sys
import cv2, numpy as np

PATTERN = (9, 6)  # inner corners (cols, rows) — 10×7 squares texture
SUBPIX_CRIT = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 1e-5)
CALIB_CRIT = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 500, 1e-8)
CLEAN_VIEWS = {
    'frontal.png', 'left_off.png', 'right_off.png',
    'tilt_x_+25.png', 'tilt_x_-25.png',
    'tilt_y_+30.png', 'tilt_y_-30.png',
}


def detect(paths, only=None):
    img_pts, used = [], []
    img_size = None
    for p in paths:
        if only is not None and os.path.basename(p) not in only:
            continue
        img = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue
        h, w = img.shape
        if img_size is None: img_size = (w, h)
        elif (w, h) != img_size:
            continue
        found, c = cv2.findChessboardCorners(
            img, PATTERN,
            cv2.CALIB_CB_ADAPTIVE_THRESH + cv2.CALIB_CB_NORMALIZE_IMAGE + cv2.CALIB_CB_FILTER_QUADS,
        )
        if not found:
            print(f'  ✘ no corners: {os.path.basename(p)}')
            continue
        c = cv2.cornerSubPix(img, c, (11, 11), (-1, -1), SUBPIX_CRIT)
        img_pts.append(c)
        used.append(os.path.basename(p))
    return img_pts, used, img_size


def make_obj(aspect, n):
    op = np.zeros((PATTERN[0] * PATTERN[1], 3), np.float32)
    op[:, :2] = np.mgrid[0:PATTERN[0], 0:PATTERN[1]].T.reshape(-1, 2).astype(np.float32)
    op[:, 1] *= aspect
    return [op] * n


def calibrate(obj_pts, img_pts, img_size, K0, flags):
    return cv2.calibrateCamera(obj_pts, img_pts, img_size, K0.copy(),
                               np.zeros(5), flags=flags, criteria=CALIB_CRIT)


def fmt_K(K):
    return (f'  ⎡ {K[0,0]:8.2f}  {K[0,1]:8.2f}  {K[0,2]:8.2f} ⎤\n'
            f'  ⎢ {K[1,0]:8.2f}  {K[1,1]:8.2f}  {K[1,2]:8.2f} ⎥\n'
            f'  ⎣ {K[2,0]:8.2f}  {K[2,1]:8.2f}  {K[2,2]:8.2f} ⎦')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--captures', default='demo/test/calib')
    ap.add_argument('--out', default='tools/camera-intrinsics-empirical.json')
    ap.add_argument('--commanded-distance-cm', type=float, default=50.0,
                    help='LS-z position commanded for the frontal pose (used to derive cm/obj-unit)')
    args = ap.parse_args()

    paths = sorted(glob.glob(os.path.join(args.captures, '*.png')))
    print(f'Found {len(paths)} captures, using {len(CLEAN_VIEWS)} clean subset.')
    img_pts, used, img_size = detect(paths, only=CLEAN_VIEWS)
    if len(img_pts) < 5:
        sys.exit(f'Need ≥5 clean views; got {len(img_pts)}: {used}')

    W, H = img_size

    # Analytical K from declared fov
    fov_v_decl = np.deg2rad(63.541019480008295)
    fy_anal = (H / 2) / np.tan(fov_v_decl / 2)
    aspect_rt = W / H
    fov_h_decl = 2 * np.arctan(np.tan(fov_v_decl / 2) * aspect_rt)
    fx_anal = (W / 2) / np.tan(fov_h_decl / 2)
    K_anal = np.array([[fx_anal, 0, W / 2], [0, fy_anal, H / 2], [0, 0, 1]])

    print(f'\nImage size: {W}×{H}')
    print(f'Analytical K (declared vFov={np.degrees(fov_v_decl):.2f}°, hFov={np.degrees(fov_h_decl):.2f}°):')
    print(fmt_K(K_anal))

    # Sweep object-aspect to find min RMS (chessboard squares are rectangular
    # because the 10:7 texture is on a stretched plane; we don't know the
    # exact physical aspect a priori).
    K0 = K_anal.copy()
    aspect_search = np.concatenate([np.linspace(2.5, 2.95, 19), np.linspace(2.95, 3.1, 4)])
    flags_for_search = (
        cv2.CALIB_USE_INTRINSIC_GUESS | cv2.CALIB_FIX_ASPECT_RATIO |
        cv2.CALIB_FIX_PRINCIPAL_POINT |
        cv2.CALIB_FIX_K1 | cv2.CALIB_FIX_K2 | cv2.CALIB_FIX_K3 |
        cv2.CALIB_FIX_K4 | cv2.CALIB_FIX_K5 | cv2.CALIB_FIX_K6 |
        cv2.CALIB_ZERO_TANGENT_DIST
    )
    best = (np.inf, None, None)
    for a in aspect_search:
        rms, K, d, rv, tv = calibrate(make_obj(a, len(img_pts)), img_pts, img_size, K0, flags_for_search)
        if rms < best[0]:
            best = (float(rms), float(a), float(K[0, 0]))
    a_opt, fx_at_opt = best[1], best[2]
    print(f'\nOptimal chessboard aspect (h/w) for square-pixel pinhole: {a_opt:.4f}'
          f'   (RMS={best[0]:.4f} px,  fx=fy={fx_at_opt:.2f})')

    # Final pinhole calibration with optimal aspect, free fx, fy and PP
    obj = make_obj(a_opt, len(img_pts))
    flags_pin = (cv2.CALIB_USE_INTRINSIC_GUESS |
                 cv2.CALIB_FIX_K1 | cv2.CALIB_FIX_K2 | cv2.CALIB_FIX_K3 |
                 cv2.CALIB_FIX_K4 | cv2.CALIB_FIX_K5 | cv2.CALIB_FIX_K6 |
                 cv2.CALIB_ZERO_TANGENT_DIST)
    rms_p, K_p, d_p, rv_p, tv_p = calibrate(obj, img_pts, img_size, K0, flags_pin)
    print(f'\n[PINHOLE, free fx, fy, cx, cy]   RMS = {rms_p:.4f} px')
    print(fmt_K(K_p))

    # Square-pixel pinhole (fx=fy)
    flags_sq = flags_pin | cv2.CALIB_FIX_ASPECT_RATIO
    rms_s, K_s, d_s, rv_s, tv_s = calibrate(obj, img_pts, img_size, K0, flags_sq)
    print(f'\n[PINHOLE, fx=fy, free cx, cy]   RMS = {rms_s:.4f} px')
    print(fmt_K(K_s))

    # Per-view diagnostics
    cm_per_obj = args.commanded_distance_cm / float(tv_s[0][2, 0])  # frontal first
    print(f'\nFrontal commanded distance = {args.commanded_distance_cm} cm,'
          f' recovered t_z (frontal) = {float(tv_s[0][2,0]):.2f} obj-units'
          f' ⇒ 1 obj-unit ≈ {cm_per_obj:.4f} cm')
    print(f'Each chessboard square ≈ {cm_per_obj:.3f} cm wide × {cm_per_obj * a_opt:.3f} cm tall'
          f' (aspect {a_opt:.2f})')
    fov_v_eff = 2 * np.degrees(np.arctan(H / 2 / K_s[1, 1]))
    fov_h_eff = 2 * np.degrees(np.arctan(W / 2 / K_s[0, 0]))
    print(f'Effective vFov ≈ {fov_v_eff:.2f}°  (declared {np.degrees(fov_v_decl):.2f}°)')
    print(f'Effective hFov ≈ {fov_h_eff:.2f}°  (declared {np.degrees(fov_h_decl):.2f}°)')

    print('\nPer-view reprojection error (square-pixel pinhole):')
    per_view = []
    for i, n in enumerate(used):
        proj, _ = cv2.projectPoints(obj[i], rv_s[i], tv_s[i], K_s, d_s)
        e = np.linalg.norm(proj.reshape(-1, 2) - img_pts[i].reshape(-1, 2), axis=1)
        print(f'  {n:25s}  mean={e.mean():5.2f}  max={e.max():5.2f}  '
              f't_z={float(tv_s[i][2,0]):6.2f} obj-units '
              f'≈ {float(tv_s[i][2,0])*cm_per_obj:6.2f} cm')
        per_view.append({'view': n, 'mean_err_px': float(e.mean()),
                         'max_err_px': float(e.max()),
                         't_z_obj_units': float(tv_s[i][2, 0]),
                         't_z_cm': float(tv_s[i][2, 0]) * cm_per_obj})

    out = {
        'image_size': {'w': W, 'h': H},
        'pattern_inner_corners': PATTERN,
        'square_aspect_h_over_w': a_opt,
        'cm_per_obj_unit_estimate': cm_per_obj,
        'analytical_K': K_anal.tolist(),
        'pinhole_free_K': {
            'rms_reproj_px': float(rms_p),
            'K': K_p.tolist(),
        },
        'pinhole_square_pixels': {
            'rms_reproj_px': float(rms_s),
            'K': K_s.tolist(),
            'fx_eq_fy': float(K_s[0, 0]),
            'cx': float(K_s[0, 2]),
            'cy': float(K_s[1, 2]),
            'effective_vfov_deg': float(fov_v_eff),
            'effective_hfov_deg': float(fov_h_eff),
        },
        'per_view': per_view,
        'used_views': used,
    }
    with open(args.out, 'w') as f:
        json.dump(out, f, indent=2)
    print(f'\nWrote {args.out}')


if __name__ == '__main__':
    main()
