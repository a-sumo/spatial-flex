#!/usr/bin/env python3
"""
viewcone-mcp.py — super-commands for ViewCone live-streaming setup.

What this does
--------------
Sets up the LS scene needed to stream the lens preview to a browser viewer
via Snap Cloud (Supabase Realtime). Talks to the *native* Lens Studio MCP
server (HTTP/JSON-RPC on a localhost port) and orchestrates the multi-step
operations that are otherwise tedious to perform by hand or one tool at a time.

Subcommands
-----------
  check        Diagnose project, packages, scene; lists what's missing.
  composite    Instantiate the CompositeImage prefab into the scene.
  streaming    Create a Streaming SceneObject and attach the two scripts.
  wire         Wire SupabaseProject -> SnapCloudRequirements -> LayoutPreviewStreamer.
  layers       Set Layer 2 on a SceneObject (so VirtRender renders it).
  setup        Run check -> composite -> streaming -> wire as one pipeline.
  list-ports   Probe likely LS MCP ports and report which are reachable.

Pre-conditions (must be done in LS by hand, MCP cannot do these)
----------------------------------------------------------------
  * LS open with this project.
  * Snap Cloud / Supabase plugin installed; Window > Supabase logged in.
  * SupabaseProject.supabaseProject asset created via 'Import Credentials'.
  * Required .lspkg packages present on disk:
       Packages/SupabaseClient.lspkg
       Assets/CompositeCameraTexture.lspkg
  * LayoutPreviewStreamer.ts and SnapCloudRequirements.ts deployed in Assets/.

Usage
-----
  ./viewcone-mcp.py check
  ./viewcone-mcp.py setup
  ./viewcone-mcp.py composite --port 8731
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

# ── Project layout ────────────────────────────────────────────────────
LS_PROJECT_DIR = Path(
    os.environ.get(
        'VIEWCONE_LS_DIR',
        '/Users/armand/Documents/spatial-flex/libs/view-cone-layout/ViewConeLayout',
    )
)
ASSETS_DIR = LS_PROJECT_DIR / 'Assets'
PACKAGES_DIR = LS_PROJECT_DIR / 'Packages'

REQUIRED_PACKAGES = {
    PACKAGES_DIR / 'SupabaseClient.lspkg':
        'Snap Cloud / Supabase realtime client. '
        'Install via the Snap Cloud plugin (Window > Supabase).',
}
REQUIRED_ASSETS = {
    ASSETS_DIR / 'CompositeCameraTexture.lspkg':
        'CompositeImage prefab + materials + composite render target. '
        'Get from the Snap Spectacles "Composite Camera Texture" sample, '
        'drop the .lspkg under Assets/.',
    ASSETS_DIR / 'Streaming' / 'LayoutPreviewStreamer.ts':
        'The streamer script. Already in this project — '
        'do not delete or move out of Assets/Streaming/.',
    ASSETS_DIR / 'Scripts' / 'SnapCloudRequirements.ts':
        'Holds the SupabaseProject reference. Already in this project.',
}

# Default Snap Cloud config (for the streaming SceneObject's channel name).
DEFAULT_CHANNEL = 'viewcone-live-stream'

# Common ports used by the native LS MCP (Lens Studio's built-in MCP server).
DEFAULT_PORTS = [8731, 8733, 8732, 8730]
DEFAULT_TOKEN = os.environ.get(
    'LS_MCP_TOKEN',
    'hTUjzELMgjXK6IURKoes4P0U2cQTnPLxvfnpp-vppt7lmzcoLFfOz3ZMzoroAJ6x',
)

# ── ANSI helpers ──────────────────────────────────────────────────────
USE_COLOR = sys.stdout.isatty()
def _c(code, s):
    return f'\033[{code}m{s}\033[0m' if USE_COLOR else s
def warn(msg):  print(_c('33', f'⚠  {msg}'), file=sys.stderr)
def err(msg):   print(_c('31', f'✖  {msg}'), file=sys.stderr)
def ok(msg):    print(_c('32', f'✓  {msg}'))
def step(msg):  print(_c('36', f'▸  {msg}'))
def info(msg):  print(f'   {msg}')

# ── MCP transport ─────────────────────────────────────────────────────
class LsMcp:
    def __init__(self, port, token=DEFAULT_TOKEN):
        self.url = f'http://localhost:{port}/mcp'
        self.token = token
        self.port = port

    def _post(self, payload):
        req = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode('utf-8'),
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {self.token}',
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def call(self, method, params=None):
        payload = {'jsonrpc': '2.0', 'id': 1, 'method': method}
        if params is not None:
            payload['params'] = params
        return self._post(payload)

    def tool(self, name, args=None):
        out = self.call('tools/call', {'name': name, 'arguments': args or {}})
        if 'error' in out:
            raise RuntimeError(f'{name}: {out["error"]}')
        result = out.get('result', {})
        try:
            txt = result['content'][0]['text']
        except (KeyError, IndexError, TypeError):
            return result
        try:
            return json.loads(txt)
        except (TypeError, ValueError):
            return txt

    def reachable(self):
        try:
            self.call('tools/list')
            return True
        except Exception:
            return False

    @classmethod
    def autodetect(cls, ports=DEFAULT_PORTS, scene_hint=None):
        """Pick the LS instance whose scene matches our project.

        scene_hint: a substring expected somewhere in the scene graph dump
        (e.g. an asset/object name unique to the project). If None, returns
        the first reachable instance.
        """
        candidates = []
        for p in ports:
            ls = cls(p)
            if not ls.reachable():
                continue
            if scene_hint is None:
                return ls
            try:
                tree = ls.tool('GetLensStudioSceneGraph')
            except Exception:
                continue
            if scene_hint.lower() in json.dumps(tree).lower():
                return ls
            candidates.append(ls)
        # No match for hint; fall back to first reachable so caller can decide.
        return candidates[0] if candidates else None

# ── Filesystem checks ─────────────────────────────────────────────────
def check_filesystem():
    missing = []
    for path, why in {**REQUIRED_PACKAGES, **REQUIRED_ASSETS}.items():
        if not path.exists():
            missing.append((path, why))
    return missing

# ── Scene helpers ─────────────────────────────────────────────────────
def find_scene_object(ls, name, recursive=True):
    """Return scene-object dict whose name matches, or None."""
    try:
        out = ls.tool('GetLensStudioSceneObjectByName',
                      {'name': name, 'recursive': recursive})
    except Exception:
        return None
    if isinstance(out, list):
        return out[0] if out else None
    if isinstance(out, dict):
        # MCP returns {message, objects: [...]} on miss, or a single object on hit.
        if 'objects' in out:
            objs = out.get('objects') or []
            return objs[0] if objs else None
        return out if out.get('id') else None
    return None

def find_asset(ls, name):
    try:
        out = ls.tool('GetLensStudioAssetsByName', {'name': name})
    except Exception:
        return None
    if isinstance(out, list):
        return out[0] if out else None
    if isinstance(out, dict):
        if 'assets' in out:
            assets = out.get('assets') or []
            return assets[0] if assets else None
        return out if out.get('id') else None
    return None

def get_scene_graph(ls):
    return ls.tool('GetLensStudioSceneGraph')

def top_level_names(graph):
    return [c.get('name') for c in graph.get('sceneTree', {}).get('children', [])]

# ── Diagnose ──────────────────────────────────────────────────────────
def cmd_check(args):
    print(_c('1', '\nViewCone streaming setup — diagnostic\n'))

    # 1. Filesystem
    step('Checking required files on disk')
    missing = check_filesystem()
    if missing:
        for path, why in missing:
            err(f'missing: {path}')
            info(f'why: {why}')
    else:
        ok(f'all required files present under {LS_PROJECT_DIR}')

    # 2. LS reachability
    step('Probing Lens Studio MCP ports')
    ls = LsMcp.autodetect(scene_hint='ViewCone')
    if ls is None:
        ls = LsMcp.autodetect()  # any reachable LS
    if ls is None:
        err('No LS MCP instance reachable on any of: '
            + ', '.join(str(p) for p in DEFAULT_PORTS))
        info('Open Lens Studio and ensure the MCP server is running '
             '(Settings > MCP). Then re-run.')
        return 2
    ok(f'connected to LS MCP on port {ls.port}')

    # 3. Scene contents
    step('Inspecting scene')
    try:
        graph = get_scene_graph(ls)
    except Exception as e:
        err(f'GetLensStudioSceneGraph failed: {e}')
        return 2
    names = top_level_names(graph)
    info(f'top-level objects: {names}')

    expected = {
        'Camera Object': 'main lens camera (must be at the BOTTOM of the hierarchy)',
        'CompositeImage': 'composite background + virtual content (run `composite`)',
        'Streaming':       'holder for SnapCloudRequirements + LayoutPreviewStreamer (run `streaming`)',
    }
    present = []
    absent = []
    for n, why in expected.items():
        (present if n in names else absent).append((n, why))
    for n, _ in present:
        ok(f'present: {n}')
    for n, why in absent:
        warn(f'missing scene object: {n}  — {why}')

    # 4. Camera-at-bottom invariant
    if 'Camera Object' in names:
        idx = names.index('Camera Object')
        if idx == len(names) - 1:
            ok('Camera Object is at the bottom (correct render order)')
        else:
            warn(f'Camera Object is at position {idx + 1} of {len(names)} — '
                 'must be LAST so render targets fill before the camera reads them')

    # 5. SupabaseProject asset
    step('Checking SupabaseProject asset')
    sp = find_asset(ls, 'SupabaseProject')
    if not sp:
        warn('No SupabaseProject asset found.')
        info('Create via Window > Supabase > Import Credentials in Lens Studio.')
    else:
        ok(f'SupabaseProject asset found')

    # 6. Streamer wiring
    step('Checking streamer wiring')
    streaming = find_scene_object(ls, 'Streaming')
    if streaming:
        comps = [c.get('type') for c in streaming.get('components', [])]
        info(f'Streaming components: {comps}')
        if 'ScriptComponent' not in comps:
            warn('Streaming has no ScriptComponent — run `wire`.')
    else:
        warn('No Streaming SceneObject yet.')

    print()
    return 0 if not missing and not absent else 1

# ── Composite ─────────────────────────────────────────────────────────
def cmd_composite(args):
    ls = _need_ls(args)
    if not ls:
        return 2

    step('Instantiating CompositeImage prefab')
    if find_scene_object(ls, 'CompositeImage'):
        ok('CompositeImage already in scene — skipping')
        return 0

    prefab_path = 'Assets/CompositeCameraTexture.lspkg/CompositeImage__PLACE_IN_SCENE.prefab'
    prefab_fs = LS_PROJECT_DIR / prefab_path
    if not prefab_fs.exists():
        err(f'prefab not found at {prefab_fs}')
        info('Make sure the CompositeCameraTexture.lspkg is under Assets/.')
        return 2

    try:
        out = ls.tool('InstantiateLensStudioPrefab', {'prefabPath': prefab_path})
    except Exception as e:
        err(f'InstantiateLensStudioPrefab failed: {e}')
        return 2
    ok(f'CompositeImage instantiated')
    info('Reminder: keep Camera Object at the BOTTOM of the hierarchy.')
    return 0

# ── Streaming SceneObject ─────────────────────────────────────────────
def cmd_streaming(args):
    ls = _need_ls(args)
    if not ls:
        return 2

    step('Creating Streaming SceneObject + scripts')
    so = find_scene_object(ls, 'Streaming')
    if so:
        ok('Streaming SceneObject already exists — skipping creation')
    else:
        try:
            so = ls.tool('CreateLensStudioSceneObject', {'name': 'Streaming'})
        except Exception as e:
            err(f'CreateLensStudioSceneObject failed: {e}')
            return 2
        ok('Streaming SceneObject created')

    so_id = so.get('id') if isinstance(so, dict) else None
    if not so_id:
        err('Could not resolve Streaming object id')
        return 2

    # Attach the two scripts as ScriptComponents.
    for script_name, asset_path in [
        ('SnapCloudRequirements', 'Assets/Scripts/SnapCloudRequirements.ts'),
        ('LayoutPreviewStreamer', 'Assets/Streaming/LayoutPreviewStreamer.ts'),
    ]:
        ts_fs = LS_PROJECT_DIR / asset_path
        if not ts_fs.exists():
            err(f'{script_name}: source file missing at {ts_fs}')
            info(f'why: required for the streaming pipeline. Restore the file before re-running.')
            return 2
        try:
            ls.tool('CreateLensStudioComponent', {
                'sceneObjectId': so_id,
                'componentType': 'ScriptComponent',
                'scriptAssetPath': asset_path,
            })
            ok(f'attached ScriptComponent: {script_name}')
        except Exception as e:
            warn(f'attach {script_name} failed (may already exist): {e}')

    info('Now run `wire` to connect SupabaseProject -> SnapCloudReq -> Streamer.')
    return 0

# ── Wire references ───────────────────────────────────────────────────
def cmd_wire(args):
    ls = _need_ls(args)
    if not ls:
        return 2

    step('Wiring references')
    sp = find_asset(ls, 'SupabaseProject')
    if not sp:
        err('No SupabaseProject asset.')
        info('Create via Window > Supabase > Import Credentials, then re-run.')
        return 2
    sp_id = sp.get('id')

    streaming = find_scene_object(ls, 'Streaming')
    if not streaming:
        err('No Streaming SceneObject. Run `streaming` first.')
        return 2

    # Find the two ScriptComponents on Streaming.
    sc_req = sc_str = None
    for c in streaming.get('components', []):
        if c.get('type') != 'ScriptComponent':
            continue
        # Prefer name from the ScriptAsset reference if exposed.
        nm = (c.get('name') or '') + ' ' + (c.get('scriptAssetName') or '')
        nm = nm.lower()
        if 'snapcloudrequirements' in nm or 'requirements' in nm:
            sc_req = c
        elif 'layoutpreviewstreamer' in nm or 'streamer' in nm:
            sc_str = c
    if not sc_req or not sc_str:
        warn('Could not unambiguously identify the two ScriptComponents.')
        info('If the components are unnamed, manually drag the references in LS '
             'or re-run `streaming` after deleting them.')
        return 2

    # SnapCloudRequirements.supabaseProject -> SupabaseProject asset
    try:
        ls.tool('SetLensStudioProperty', {
            'componentId': sc_req.get('id'),
            'propertyPath': 'supabaseProject',
            'value': {'assetId': sp_id},
        })
        ok('SnapCloudRequirements.supabaseProject ← SupabaseProject asset')
    except Exception as e:
        err(f'wiring SnapCloudReq failed: {e}')
        return 2

    # LayoutPreviewStreamer.snapCloudRequirements -> the SnapCloudRequirements component
    try:
        ls.tool('SetLensStudioProperty', {
            'componentId': sc_str.get('id'),
            'propertyPath': 'snapCloudRequirements',
            'value': {'componentId': sc_req.get('id')},
        })
        ok('LayoutPreviewStreamer.snapCloudRequirements ← SnapCloudRequirements')
    except Exception as e:
        err(f'wiring streamer.snapCloudRequirements failed: {e}')

    # Set channel name
    try:
        ls.tool('SetLensStudioProperty', {
            'componentId': sc_str.get('id'),
            'propertyPath': 'channelName',
            'value': args.channel,
        })
        ok(f'LayoutPreviewStreamer.channelName ← "{args.channel}"')
    except Exception as e:
        warn(f'setting channelName failed: {e}')

    # Wire textures
    composite_rt = find_asset(ls, 'CompositeImage')
    lens_rt = find_asset(ls, 'Render Target')
    if composite_rt:
        try:
            ls.tool('SetLensStudioProperty', {
                'componentId': sc_str.get('id'),
                'propertyPath': 'compositeTexture',
                'value': {'assetId': composite_rt.get('id')},
            })
            ok('LayoutPreviewStreamer.compositeTexture ← CompositeImage RT')
        except Exception as e:
            warn(f'setting compositeTexture failed: {e}')
    else:
        warn('Composite RT not found by name "CompositeImage".')
    if lens_rt:
        try:
            ls.tool('SetLensStudioProperty', {
                'componentId': sc_str.get('id'),
                'propertyPath': 'lensTexture',
                'value': {'assetId': lens_rt.get('id')},
            })
            ok('LayoutPreviewStreamer.lensTexture ← Render Target')
        except Exception as e:
            warn(f'setting lensTexture failed: {e}')
    else:
        warn('Lens RT not found by name "Render Target".')

    return 0

# ── Layers ────────────────────────────────────────────────────────────
def cmd_layers(args):
    """Set Layers=2 (the VirtRender layer) on a SceneObject and its descendants."""
    ls = _need_ls(args)
    if not ls:
        return 2

    obj = find_scene_object(ls, args.name)
    if not obj:
        err(f'no SceneObject named {args.name!r}')
        return 2

    def walk(node):
        try:
            ls.tool('SetLensStudioProperty', {
                'sceneObjectId': node.get('id'),
                'propertyPath': 'layers',
                'value': args.layer,
            })
            info(f'set layer {args.layer} on {node.get("name")}')
        except Exception as e:
            warn(f'set layer on {node.get("name")} failed: {e}')
        for c in node.get('children', []):
            walk(c)
    walk(obj)
    ok(f'layer {args.layer} applied to {args.name} subtree')
    return 0

# ── Setup pipeline ────────────────────────────────────────────────────
def cmd_setup(args):
    rc = cmd_check(args)
    if rc == 2:
        return rc  # fatal
    cmd_composite(args)
    cmd_streaming(args)
    cmd_wire(args)
    print()
    step('Re-running diagnostic')
    return cmd_check(args)

def cmd_list_ports(args):
    print(_c('1', '\nLS MCP port probe\n'))
    for p in DEFAULT_PORTS:
        ls = LsMcp(p)
        if ls.reachable():
            try:
                tree = ls.tool('GetLensStudioSceneGraph')
                names = top_level_names(tree)
                hint = ', '.join(names[:4]) + ('…' if len(names) > 4 else '')
                ok(f'{p}: reachable — top-level: [{hint}]')
            except Exception as e:
                ok(f'{p}: reachable (scene query failed: {e})')
        else:
            info(f'{p}: not reachable')
    return 0

# ── Helpers ───────────────────────────────────────────────────────────
def _need_ls(args):
    if args.port:
        ls = LsMcp(args.port)
        if not ls.reachable():
            err(f'LS MCP not reachable on --port {args.port}')
            return None
        return ls
    ls = LsMcp.autodetect(scene_hint='ViewCone') or LsMcp.autodetect()
    if not ls:
        err('No LS MCP reachable on '
            + ', '.join(str(p) for p in DEFAULT_PORTS))
        info('Open LS or pass --port <n>.')
        return None
    return ls

# ── CLI ───────────────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(
        description='ViewCone streaming setup super-commands (LS MCP).',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='Run with --help on any subcommand for details.',
    )
    p.add_argument('--port', type=int, default=None,
                   help='LS MCP port (default: auto-detect from %s)' % DEFAULT_PORTS)
    sub = p.add_subparsers(dest='cmd', required=True)

    sub.add_parser('check', help='diagnose project + scene state')\
       .set_defaults(func=cmd_check)
    sub.add_parser('list-ports', help='probe likely LS MCP ports')\
       .set_defaults(func=cmd_list_ports)
    sub.add_parser('composite', help='instantiate CompositeImage prefab')\
       .set_defaults(func=cmd_composite)
    sub.add_parser('streaming', help='create Streaming SceneObject + scripts')\
       .set_defaults(func=cmd_streaming)

    pw = sub.add_parser('wire', help='wire SupabaseProject -> Req -> Streamer')
    pw.add_argument('--channel', default=DEFAULT_CHANNEL,
                    help=f'channel name (default: {DEFAULT_CHANNEL})')
    pw.set_defaults(func=cmd_wire)

    pl = sub.add_parser('layers', help='set layer on SceneObject + descendants')
    pl.add_argument('name', help='SceneObject name')
    pl.add_argument('--layer', type=int, default=2, help='layer index (default: 2)')
    pl.set_defaults(func=cmd_layers)

    ps = sub.add_parser('setup', help='run check + composite + streaming + wire')
    ps.add_argument('--channel', default=DEFAULT_CHANNEL)
    ps.set_defaults(func=cmd_setup)

    args = p.parse_args()
    sys.exit(args.func(args) or 0)

if __name__ == '__main__':
    main()
