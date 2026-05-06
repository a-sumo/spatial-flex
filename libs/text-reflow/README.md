# text-reflow

A pure TypeScript word-wrap and text-metrics engine for Lens Studio / Snap Spectacles.

Part of [`spatial-flex`](../..) — drop-in spatial UI primitives.

Lens Studio's `Component.Text` doesn't expose `measureText()`, so authoring layouts that wrap, fit, or flow around obstacles is hard. This script gives you a calibrated metrics estimator and a pretext-inspired greedy line breaker. One file, zero dependencies, drag-and-drop ready.

## Demo

https://github.com/curvilinear-space/spatial-flex/raw/main/libs/text-reflow/media/demo.mp4

<video src="media/demo.mp4" controls width="100%"></video>

Text reflowing live on Spectacles as the panel resizes — measurement and line breaking run in pure arithmetic, so reflow is cheap enough to run every frame.

## Install

Drag `TextLayout.ts` into your Lens Studio project's `Assets/` folder. That's it. The `.meta` file is included so the asset import is stable.

```
YourProject/
  Assets/
    TextLayout.ts
    TextLayout.ts.meta
```

Import from any script:

```ts
import { TextLayout, TextMetricsConfig } from './TextLayout';
```

If you place it in a subfolder, adjust the relative path.

## Quick start

Wrap a string to fit a width and push it into a `Component.Text`:

```ts
import { TextLayout } from './TextLayout';

const result = TextLayout.wrap(
  "The quick brown fox jumps over the lazy dog.",
  42,    // font size in LS points
  20     // max width in cm (0 = no wrap, single line)
);

textComponent.text = TextLayout.joinLines(result.lines);
textComponent.size = result.effectiveFontSize;
// result.width, result.height are in cm — use to size a parent panel
```

## API

### `TextLayout.wrap(text, fontSize, maxWidth, autoShrink?, minFontSize?, cfg?) → WrapResult`

Full pipeline: segment → measure → break → compute bounds.

| param | type | meaning |
| --- | --- | --- |
| `text` | `string` | text to wrap |
| `fontSize` | `number` | font size in LS points |
| `maxWidth` | `number` | max width in cm (`0` = no wrap) |
| `autoShrink` | `boolean?` | shrink font to fit a single line |
| `minFontSize` | `number?` | floor when `autoShrink` is on (default `24`) |
| `cfg` | `TextMetricsConfig?` | per-font tuning (see below) |

Returns:

```ts
{
  lines: { text: string, width: number }[],
  width: number,             // widest line, cm
  height: number,            // total block height, cm
  lineCount: number,
  effectiveFontSize: number  // may differ from fontSize if autoShrink fired
}
```

### `TextLayout.wrapAroundCircle(text, fontSize, panelW, panelH, cx, cy, cr, padding, cfg?) → CircleWrapResult`

Reflow text around a circular obstacle on a panel. For each line, the circle's chord at that Y is subtracted from the available width on the side the circle sits. Returns per-line `{ text, width, xOffset, y, maxWidth }` so you can render lines as individual `Component.Text` objects positioned in panel-local space.

Useful when an icon, image, or button sits inside a text panel and you want the copy to flow around it.

### `TextLayout.estimateWidth(text, fontSize, cfg?) → number`

World-space width of a string in cm. Uses character width factors calibrated against `Component.Text` rendering.

### `TextLayout.lineHeight(fontSize) → number`

Single-line height in cm.

### `TextLayout.lineSpacing() → number`

Line-to-line distance multiplier (default `1.25`).

### `TextLayout.configForFont(fontName, widthScale?) → TextMetricsConfig`

Build a metrics config from a font name. Auto-detects monospace from the name (Hack, Fira Code, JetBrains Mono, etc.).

```ts
const cfg = TextLayout.configForFont("Hack");           // monospace = true
const cfg = TextLayout.configForFont("Inter", 1.05);    // 5% safety margin
```

### `TextLayout.joinLines(lines) → string`

Join `WrappedLine[]` with `\n` for use in `Component.Text`.

## Tuning

The width estimator uses three character classes (narrow, normal, wide) and per-em factors calibrated for proportional Latin fonts in the Helvetica / Inter family. If text bleeds past your container, raise `widthScale` slightly:

```ts
const cfg = new TextMetricsConfig();
cfg.widthScale = 1.05;     // 5% wider estimate, wraps sooner
const result = TextLayout.wrap(text, 42, 20, false, 24, cfg);
```

For monospace fonts, set `cfg.monospace = true` (or use `configForFont` and pass a known monospace name).

## How it works

Two-phase pretext-style measurement:

1. **Segment** — split into runs of words and whitespace, measure each once.
2. **Reflow** — greedy line breaking, walking left to right, accumulating width until the next word would overflow.

Words wider than `maxWidth` break at character boundaries. Trailing whitespace hangs past the edge (CSS behavior). All math is pure arithmetic — no DOM, no canvas, no scene-graph access.

This means you can call `wrap()` cheaply at any width and get a deterministic layout, which is what makes responsive panels and frame-resize reflow practical on Spectacles.

## License

MIT. Feel free to copy, adapt, and ship.

## Credits

Word-breaking algorithm inspired by [pretext](https://github.com/chenglou/pretext) by chenglou. Calibration factors derived from observation of `Component.Text` rendering on Spectacles.

Maintained by [Curvilinear](https://github.com/curvilinear-space).
