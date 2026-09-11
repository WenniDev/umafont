import {
  DEFAULT_SPEC, FONT_DISPLAY, FONT_SUBTITLE, drawLayer, measureLayer, type LogoSpec,
} from './logo';

export { DEFAULT_SPEC };

/** Shortest the on-screen preview may get before the stage scrolls instead. */
const PREVIEW_MIN_H = 200;

export interface Rendered { width: number; height: number }

export function renderLogo(canvas: HTMLCanvasElement, spec: LogoSpec, dpr = window.devicePixelRatio || 1): Rendered {
  const ctx = canvas.getContext('2d')!;

  // --- measurements, at scale 1 ---
  const main = measureLayer(ctx, spec.mainSegments, spec.mainStyle);
  const sub = measureLayer(ctx, spec.subSegments, spec.subStyle);
  const S = spec.mainStyle.size;
  // The border stack spills outside the letter: without this margin the
  // outermost border would be clipped by the canvas edge.
  const stack = (o: { borders: { width: number }[] }, size: number) =>
    o.borders.reduce((a, b) => a + Math.max(0, b.width), 0) * size;
  const pad = S * 0.4 + Math.max(stack(spec.mainOutline, S),
                                 stack(spec.subOutline, spec.subStyle.size));
  const stackMain = stack(spec.mainOutline, S);
  const stackSub = stack(spec.subOutline, spec.subStyle.size);

  // Subtitle placement, measured on ref/logo_hires.png: centred under the
  // wordmark with a slight rightward bias, its baseline 0.893 cap lower.
  const subIndent = (main.width - sub.width) / 2 + S * spec.subPos.bias;
  const subDrop = S * spec.subPos.drop;

  // True bounds of both lines, borders included: the subtitle can overhang on
  // either side when its text runs longer.
  const left = Math.min(-stackMain, subIndent - stackSub);
  const right = Math.max(main.width + stackMain, subIndent + sub.width + stackSub);
  const width = Math.ceil(pad * 2 + (right - left));
  // An empty subtitle still measures: measureLayer falls back to the metrics of
  // an 'M' so that a caller can place an empty line, while drawLayer returns
  // without drawing. Reserving its drop and descent regardless baked a blank
  // band under the wordmark -- 127 px at the defaults -- into the canvas and
  // into the exported PNG.
  const height = Math.ceil(
    pad * 2 + main.ascent
    + (sub.segs.length ? subDrop + sub.descent + stackSub : 0),
  );

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  // Only the width is pinned; the height is left to the intrinsic aspect ratio
  // of the width/height attributes. Pinning both meant the stylesheet's
  // `max-width: 100%` capped the width alone while the inline height stood, so
  // a logo wider than the stage came out horizontally squashed -- 2.751 shown
  // as 1.711 even on the default text, and 7.145 as 1.711 on a long one.
  //
  // `min-width` then keeps a long logo from shrinking away to nothing: below
  // PREVIEW_MIN_H it stops scaling down and the wrapper scrolls instead, which
  // is what its `overflow-x: auto` was there for. min-width beats max-width, so
  // the two rules do not fight.
  canvas.style.width = `${width}px`;
  canvas.style.height = 'auto';
  canvas.style.minWidth = `${Math.round(width * Math.min(1, PREVIEW_MIN_H / height))}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!spec.transparent) {
    ctx.fillStyle = spec.bgColor;
    ctx.fillRect(0, 0, width, height);
  }

  const textX = pad - left;
  const mainBaseline = pad + main.ascent;
  const subBaseline = mainBaseline + subDrop;

  drawLayer(ctx, spec.subSegments, spec.subStyle, textX + subIndent, subBaseline, spec.subOutline);
  drawLayer(ctx, spec.mainSegments, spec.mainStyle, textX, mainBaseline, spec.mainOutline);

  return { width, height };
}

/** The fonts carry capitals only, so normalise before any render. */
export function normalize(text: string): string {
  return text.toUpperCase();
}

export async function loadFont(): Promise<void> {
  await Promise.all([
    document.fonts.load(`100px "${FONT_DISPLAY}"`),
    document.fonts.load(`100px "${FONT_SUBTITLE}"`),
  ]);
  await document.fonts.ready;
}
