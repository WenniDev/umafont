// Logo rendering engine. Everything goes through the Canvas: the fonts supply
// only the letter fills, the effects are drawn here.
//
// A line is a sequence of SEGMENTS, each with its own gradient -- that is what
// allows "UMA" in yellow followed by "MUSUME" in pink. The borders are stroked
// for ALL segments before any of them is filled: otherwise a segment's border
// would bite into the previous segment's fill at the junction.
//
// Each line is composed on an offscreen canvas: that is what keeps the halftone
// screen confined to the letters (source-atop composites over the whole current
// canvas, background included).

/** The wordmark: font redrawn from the logo (A-Z, 0-9). */
export const FONT_DISPLAY = 'UmamusumeDisplay';
/** The subtitle: font redrawn from the "PRETTY DERBY" lettering. */
export const FONT_SUBTITLE = 'UmamusumeSubtitle';
/** A run of text with its own vertical gradient. */
export interface Segment {
  text: string;
  gradient: [string, string];
  /** Size multiplier. The logo sets its initial at 1.542. */
  scale?: number;
  /**
   * Horizontal stretch specific to the segment. The logo's initial is not a
   * plain enlargement: it is also 1.157 times wider, stem included (0.360
   * stem/cap against 0.315 for the regular letters).
   */
  stretchMul?: number;
}

/**
 * One concentric border. `width` is its own thickness, as a fraction of the
 * font size; borders stack from the inside outwards. `colors` is a vertical
 * gradient [top, bottom]: in the logo no border is a single flat colour (the
 * wordmark's coral runs #E27D6A to #DF5D86, the subtitle's outline #9278AE to
 * #CF8FB3).
 */
export interface Border {
  colors: [string, string];
  width: number;
}

export interface LayerStyle {
  family: string;
  size: number;
  stretch: number;
  gap: number;
  /** Letter tracking, in em. */
  tracking: number;
  halftone: boolean;
  /**
   * Whether COUNTER_CORE may punch this line's counters open. Only the wordmark
   * wants it: the subtitle's are solid white in the source. This used to be
   * inferred from the bar that ran behind the subtitle, which no longer exists.
   */
  punchCounters: boolean;
  /**
   * Font slant, in degrees -- declared, not applied. The shear is baked into the
   * outlines by build/make_font.py, and the offset between segments of unequal
   * size is handled by edges()/contact()/CLEARANCE. This value is read in one
   * place only: widening the halftone band so the lattice covers the lean.
   */
  slant: number;
}

export interface OutlineStyle {
  borders: Border[];
}

/** Subtitle placement under the wordmark, in wordmark caps. */
export interface SubPos {
  /** Departure from exact centring. 0 = perfectly centred. */
  bias: number;
  /** How far the subtitle's baseline drops below the wordmark's. */
  drop: number;
}

export interface LogoSpec {
  mainSegments: Segment[];
  subSegments: Segment[];
  mainStyle: LayerStyle;
  subStyle: LayerStyle;
  mainOutline: OutlineStyle;
  subOutline: OutlineStyle;
  transparent: boolean;
  bgColor: string;
  subPos: SubPos;
}

export const DEFAULT_SPEC: LogoSpec = {
  mainSegments: [
    { text: 'UMA', gradient: ['#F7EA52', '#E77B33'] },
    { text: 'MUSUME', gradient: ['#F6D7C6', '#DF5985'] },
  ],
  subSegments: [{ text: 'PRETTY DERBY', gradient: ['#FFFFFF', '#F6E5F2'] }],
  mainStyle: { family: FONT_DISPLAY, size: 150, stretch: 1.0, gap: 0, tracking: 0, halftone: true, punchCounters: true, slant: 12 },
  subStyle: { family: FONT_SUBTITLE, size: 81, stretch: 1.0, gap: 0, tracking: 0, halftone: true, punchCounters: false, slant: 20 },
  // Stack measured off the logo: white 30 px, coral 28 px, white 18 px, for a
  // 382 px cap (see ref/logo_hires.png).
  mainOutline: {
    borders: [
      { colors: ['#FFFFFF', '#FFFFFF'], width: 0.047 },
      { colors: ['#E27D6A', '#DF5D86'], width: 0.073 },
      { colors: ['#FFFFFF', '#FFFFFF'], width: 0.079 },
    ],
  },
  // Subtitle: purple outline turning mauve (measured over rows 782 to 1024),
  // then white. Thicknesses read by probing a column inside a stem: 28 px of
  // purple and 33 of white for a 207 px cap.
  subOutline: {
    borders: [
      { colors: ['#9278AE', '#CF8FB3'], width: 0.135 },
      { colors: ['#FFFFFF', '#FFFFFF'], width: 0.159 },
    ],
  },
  transparent: false,
  bgColor: '#FFFFFF',
  // Measured on ref/logo_hires.png: margins of 277 and 242 px, i.e. 53 / 47.
  subPos: { bias: 0.046, drop: 0.893 },
};


/**
 * Subtitle / wordmark size ratio. Measured off the logo: caps of 207 px against
 * 382. Both fonts share the same cap height per em, so the ratio applies
 * directly to the font sizes.
 */
export const SUB_SIZE_RATIO = 0.542;

/**
 * Enlarged initial, measured off the logo: 1.542 times the cap height, and
 * 1.157 times wider -- stem included, which makes it a horizontal stretch
 * rather than a different cut.
 */
export const INITIAL_SCALE = 1.542;
export const INITIAL_STRETCH = 1.157;

// Bounds of the gradient ramp, measured from the TOP of the cap: the upper
// colour holds until 48 %, the transition completes at 86 %. The halftone lives
// only between those two values, as in the logo.
const GRAD_START = 0.48;
const GRAD_END = 0.86;
/** Halftone pitch, as a fraction of the font size. */
const HALFTONE_PERIOD = 0.052;
/**
 * How fast the dots come in. At 1 their opacity follows the ramp exactly; above
 * that they turn opaque sooner and then only keep growing.
 */
const DOT_FADE = 1;

const fontOf = (size: number, family: string) => `${size}px "${family}"`;

/** Sets the font AND the tracking: measureText accounts for both. */
function applyFont(ctx: CanvasRenderingContext2D, s: LayerStyle) {
  ctx.font = fontOf(s.size, s.family);
  ctx.letterSpacing = `${(s.tracking || 0) * s.size}px`;
}

/**
 * Horizontal stretch of an enlarged segment, with the shear that keeps its lean.
 *
 * Scaling x alone multiplies the tangent of the slant: at mul 1.157 the initial
 * measured 13.93 deg against 12.08 for its neighbours, while the source logo
 * holds 11.99 deg for both. So the source's initial is a WIDER CUT at the same
 * angle, not a stretched one. The shear takes the surplus lean back out --
 * c = (mul - 1) * tan(slant) leaves the baseline fixed and pulls the cap line
 * back by that much.
 */
function stretchSeg(ctx: CanvasRenderingContext2D, mul: number, slant: number) {
  if (mul === 1) return;
  ctx.transform(mul, 0, (mul - 1) * Math.tan((slant * Math.PI) / 180), 1, 0, 0);
}

const used = (segments: Segment[]) => segments.filter((s) => s.text.length > 0);

// --- Spacing an enlarged initial -------------------------------------------
// The font being oblique, two neighbouring letters do not meet through their
// boxes but through their SHAPES: the apex of one passes to the right of the
// other's foot. As soon as a letter changes size that interlock breaks, and no
// formula on the boxes recovers it. So we measure the real ink profiles and
// reposition the letter to restore the same gap it had at normal size.

/**
 * Blur applied to the outermost border, as a fraction of the font size. 0 keeps
 * the hard edge the source shows.
 */
const OUTER_BLUR = 0.02;

/**
 * Target gap between two inks at the junction, as a fraction of the size.
 *
 * Measured on the source rather than chosen: in ref/logo_hires.png the fill of
 * the enlarged U and the fill of the m come within 62 px for a 381 px cap on
 * the small letters, and the profile is flat -- 62 at its closest, 63 median --
 * because the two facing edges are parallel. That is 0.163.
 *
 * It was 0.30, which put "Um" at 0.315 of the cap, near enough double the
 * source: the letters no longer shared their coral border and the wordmark
 * read as spaced-out. 0.30 had been reached from 0.22 to stop a small T sitting
 * inside an enlarged A, but that pair is not a contact problem -- at 0.22 the
 * two inks still stood 33 px apart, the T merely nests under the A's overhang.
 * Widening every junction to hide one nesting was the wrong lever.
 */
const CLEARANCE = 0.163;

/**
 * Core of counters too narrow for the border stack. The stroke being centred on
 * the contour, every border also spills INWARD into the hole: as soon as the
 * hole is narrower than twice its reach, its two sides meet and plug it.
 *
 * 'source' : let it happen. That is what the logo shows -- the initial U of
 *            ref/logo_hires.png carries a 52 px white core in the middle of its
 *            counter -- but the bar leaps out as soon as a letter is enlarged.
 * 'open'   : punch it, and the core stays empty -- zero alpha, the background
 *            shows through. The punch is slipped between the outer border and
 *            the next one: any later and the white and the coral are already
 *            mixed in the same pixels, and erasing them would only make an
 *            already pale pixel translucent instead of separating them.
 *            Two caveats. On a white background a transparent hole is
 *            indistinguishable from the white bar it was meant to remove; the
 *            difference only shows on a transparent export or a coloured
 *            ground. And a fringe remains, faint but real (22/255 on white,
 *            against 50 before): where the counter closes, its two walls
 *            converge at 2 degrees, so the gap goes from 0.2 px to zero over
 *            23 px. That is the letter's geometry, not a rounding artefact --
 *            only a fill hides it, which is what 'ink' does.
 * 'ink'    : fill it with the second-to-last border's colour. The core joins
 *            the ring, no bar and no fringe, and that is what the source shows
 *            on its normal-size letters, where the coral closes before the
 *            white does.
 */
const COUNTER_CORE: 'source' | 'open' | 'ink' = 'open';

/** Working mask for `fixCounters`, kept between renders. */
const mask = document.createElement('canvas');
const mctx = mask.getContext('2d', { willReadFrequently: true })!;

/**
 * Reopens the core of the counters the border stack has plugged.
 *
 * The counter area is found by elimination: paint the bare glyph and flood the
 * empty space from the canvas edges; whatever stays empty without being reached
 * is enclosed inside a letter.
 *
 * In 'open' the mask stops there: the whole counter is punched out of the outer
 * border, which has no business being in it, and the following borders come
 * back into it on their own with their own antialiasing. The rim of the hole
 * does not suffer: they cover it over their full reach, well beyond the blur
 * the mask leaves once scaled up.
 * In 'ink' we further subtract what the inner border actually covers -- its own
 * stroke, dilated by its reach -- and only the core is left.
 *
 * The mask is built at CSS scale, not at canvas scale: the flood costs one pass
 * over every pixel, and redoing it at devicePixelRatio squared multiplied the
 * render time by seven. It is then scaled up by drawImage, whose interpolation
 * smooths the edge.
 */
function fixCounters(
  bc: CanvasRenderingContext2D,
  setup: (cc: CanvasRenderingContext2D, scale: number) => void,
  paint: (cc: CanvasRenderingContext2D, how: 'fill' | 'stroke') => void,
  tint: (cc: CanvasRenderingContext2D, scale: number) => void,
  reach: number,
  w: number,
  h: number,
) {
  const W = Math.ceil(w), H = Math.ceil(h), N = W * H;
  mask.width = W;
  mask.height = H;

  // 1. The bare glyph: its holes are the counters.
  setup(mctx, 1);
  mctx.fillStyle = '#000';
  paint(mctx, 'fill');
  const bare = mctx.getImageData(0, 0, W, H).data;
  const empty = new Uint8Array(N);
  for (let i = 0; i < N; i++) empty[i] = bare[i * 4 + 3] <= 40 ? 1 : 0;

  // 2. Span-based flood: on a line this wide, advancing pixel by pixel cost
  //    more than the whole rest of the render put together.
  const ext = new Uint8Array(N);
  const st: number[] = [];
  for (let x = 0; x < W; x++) { st.push(x, N - W + x); }
  for (let y = 0; y < H; y++) { st.push(y * W, y * W + W - 1); }
  while (st.length) {
    const i = st.pop()!;
    if (!empty[i] || ext[i]) continue;
    const y = (i / W) | 0, row = y * W;
    let l = i - row, r = l;
    while (l > 0 && empty[row + l - 1] && !ext[row + l - 1]) l--;
    while (r < W - 1 && empty[row + r + 1] && !ext[row + r + 1]) r++;
    for (let x = l; x <= r; x++) ext[row + x] = 1;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= H) continue;
      const nrow = ny * W;
      let x = l;
      while (x <= r) {
        while (x <= r && (!empty[nrow + x] || ext[nrow + x])) x++;
        if (x > r) break;
        st.push(nrow + x);
        while (x <= r && empty[nrow + x] && !ext[nrow + x]) x++;
      }
    }
  }
  // The holes fit in a handful of pixels; everything below is restricted to
  // their bounding box, or we would scan the whole line twice for nothing.
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0, i = y * W; x < W; x++, i++) {
      if (ext[i] || !empty[i]) continue;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      by1 = y;
    }
  }
  if (bx1 < 0) return;

  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  let img: ImageData;
  if (COUNTER_CORE === 'open') {
    // 3a. The counter as it stands.
    img = mctx.createImageData(bw, bh);
    const d = img.data;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const j = y * bw + x, i = (by0 + y) * W + bx0 + x;
        d[j * 4 + 3] = !ext[i] && empty[i] ? 255 : 0;
      }
    }
  } else {
    // 3b. What the inner border actually covers, counter included.
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, W, H);
    setup(mctx, 1);
    mctx.strokeStyle = '#000';
    mctx.lineWidth = reach * 2;
    paint(mctx, 'stroke');
    paint(mctx, 'fill');
    img = mctx.getImageData(bx0, by0, bw, bh);
    const d = img.data;
    // Paint at full opacity as soon as the border does not cover everything:
    // repainting coral over coral is invisible, whereas a proportional mask
    // would leave the square of the remaining white along the core's edge.
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const j = y * bw + x, i = (by0 + y) * W + bx0 + x;
        const a = d[j * 4 + 3];
        d[j * 4] = d[j * 4 + 1] = d[j * 4 + 2] = 0;
        d[j * 4 + 3] = !ext[i] && empty[i] && a < 255 ? 255 : 0;
      }
    }
  }
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, W, H);
  mctx.putImageData(img, bx0, by0);

  bc.save();
  bc.setTransform(1, 0, 0, 1, 0, 0);
  if (COUNTER_CORE === 'open') {
    bc.globalCompositeOperation = 'destination-out';
  } else {
    // The mask takes the border's colour, gradient included, then is simply
    // laid on top.
    mctx.globalCompositeOperation = 'source-in';
    tint(mctx, 1);
    mctx.globalCompositeOperation = 'source-over';
  }
  bc.drawImage(mask, 0, 0, bc.canvas.width, bc.canvas.height);
  bc.restore();
}

const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d', { willReadFrequently: true })!;
const edgeCache = new Map<string, { L: Int32Array; R: Int32Array; adv: number; top: number }>();

/** Left and right ink edges, row by row, relative to the origin. */
function edges(text: string, size: number, mul: number, family: string,
               tracking: number, slant: number) {
  // Tracking belongs in the key as much as in the raster: measureLayer measures
  // these same runs through applyFont, which applies it, so a profile taken
  // without it would describe a differently spaced run.
  const key = `${family}|${size.toFixed(2)}|${mul.toFixed(3)}|${tracking.toFixed(4)}|${slant}|${text}`;
  const hit = edgeCache.get(key);
  if (hit) return hit;

  const ORG = Math.ceil(size * 0.8);
  const TOP = Math.ceil(size * 1.9);
  sctx.canvas.width = Math.ceil(ORG + size * mul * text.length * 1.6 + size);
  sctx.canvas.height = TOP + Math.ceil(size * 0.4);
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, sctx.canvas.width, sctx.canvas.height);
  sctx.save();
  sctx.translate(ORG, TOP);
  stretchSeg(sctx, mul, slant);
  sctx.font = fontOf(size, family);
  sctx.letterSpacing = `${tracking * size}px`;
  sctx.textBaseline = 'alphabetic';
  sctx.fillStyle = '#000';
  sctx.fillText(text, 0, 0);
  sctx.restore();

  const W = sctx.canvas.width, H = sctx.canvas.height;
  const d = sctx.getImageData(0, 0, W, H).data;
  const L = new Int32Array(H).fill(2147483647);
  const R = new Int32Array(H).fill(-2147483648);
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) {
      if (d[row + x * 4 + 3] > 40) {
        if (L[y] === 2147483647) L[y] = x - ORG;
        R[y] = x - ORG;
      }
    }
  }
  sctx.font = `${size}px "${family}"`;
  const out = { L, R, adv: sctx.measureText(text).width * mul, top: TOP };
  edgeCache.set(key, out);
  return out;
}

/** Smallest offset between two origins for the inks to just graze. */
function contact(a: ReturnType<typeof edges>, b: ReturnType<typeof edges>) {
  let need = -Infinity;
  // Rows are walked as offsets from the BASELINE, which is the only thing the two
  // share. Each profile was rasterised at its own size, so the canvases differ in
  // height and in where the baseline sits. The previous loop ran to
  // min(a.length, b.length) in a's own index space: against a letter half again
  // as tall it stopped some 90 rows above the big glyph's baseline and never
  // reached the bottom third of the small one, so the rows where a small T meets
  // an enlarged neighbour were never compared and the two were placed as if they
  // could not touch.
  const from = -Math.max(a.top, b.top);
  const to = Math.max(a.R.length - a.top, b.L.length - b.top);
  for (let dy = from; dy < to; dy++) {
    const ya = dy + a.top, yb = dy + b.top;
    if (ya < 0 || ya >= a.R.length || yb < 0 || yb >= b.L.length) continue;
    if (a.R[ya] === -2147483648 || b.L[yb] === 2147483647) continue;
    need = Math.max(need, a.R[ya] - b.L[yb]);
  }
  return need === -Infinity ? 0 : need;
}

/** Cumulative offset of each border from the letter's edge, in px. */
function offsets(o: OutlineStyle, size: number): number[] {
  let acc = 0;
  return o.borders.map((b) => (acc += Math.max(0, b.width) * size));
}

export function measureLayer(ctx: CanvasRenderingContext2D, segments: Segment[], s: LayerStyle) {
  const segs = used(segments);
  const offs: number[] = [], widths: number[] = [], sizes: number[] = [], ascents: number[] = [];
  let inner = 0, ascent = 0, descent = 0;
  segs.forEach((seg, i) => {
    // Each segment can carry its own size: that is what allows the enlarged
    // initial without moving the baseline.
    const size = s.size * (seg.scale ?? 1);
    sizes.push(size);
    applyFont(ctx, { ...s, size });
    const m = ctx.measureText(seg.text);
    const a = m.actualBoundingBoxAscent || size * 0.75;
    const d = m.actualBoundingBoxDescent || size * 0.05;
    ascents.push(a);
    ascent = Math.max(ascent, a);
    descent = Math.max(descent, d);
    // Spacing: at equal size we keep the advance; as soon as a size changes we
    // reposition the letter to recover the same ink-to-ink gap as at normal
    // normale (cf. edges/contact plus haut).
    const mul = seg.stretchMul ?? 1;
    const k = seg.scale ?? 1;
    let lead = 0;
    const prev = i > 0 ? segs[i - 1] : null;
    if (prev) {
      const pk = prev.scale ?? 1, pmul = prev.stretchMul ?? 1;
      if (k !== 1 || pk !== 1 || mul !== 1 || pmul !== 1) {
        const tr = s.tracking || 0;
        const pe = edges(prev.text, s.size * pk, pmul, s.family, tr, s.slant);
        const ne = edges(seg.text, size, mul, s.family, tr, s.slant);
        // Target: a clean gap between the two inks. The value is empirical --
        // the profile computation and the render diverge by some twenty pixels
        // whose cause I have not pinned down, and this constant, calibrated on
        // the measured render, restores a gap comparable to that of a
        // same-size pair.
        lead = Math.max(0, contact(pe, ne) - pe.adv + CLEARANCE * s.size);
      }
    }
    const trail = 0;

    inner += lead;
    const wSeg = m.width * mul;
    offs.push(inner);
    widths.push(wSeg);
    inner += wSeg + trail;
    if (i < segs.length - 1) inner += s.gap;
  });
  if (!segs.length) {
    applyFont(ctx, s);
    const m = ctx.measureText('M');
    ascent = m.actualBoundingBoxAscent || s.size * 0.75;
    descent = m.actualBoundingBoxDescent || s.size * 0.05;
  }
  return { segs, offsets: offs, widths, sizes, ascents, inner, width: inner * s.stretch, ascent, descent };
}

/** (x, y) = left edge / baseline, in the target canvas's frame. */
export function drawLayer(
  ctx: CanvasRenderingContext2D,
  segments: Segment[],
  s: LayerStyle,
  x: number,
  y: number,
  o: OutlineStyle,
) {
  const m = measureLayer(ctx, segments, s);
  if (!m.segs.length) return;

  const cum = offsets(o, s.size);
  const maxOff = cum.length ? cum[cum.length - 1] : 0;
  const pad = Math.ceil(maxOff + s.size * 0.35);
  const w = Math.ceil(m.width + pad * 2);
  const h = Math.ceil(m.ascent + m.descent + pad * 2);

  // The layer is rasterised at the target canvas's resolution; otherwise it
  // would render at 1x and then be scaled up by devicePixelRatio (blurry text).
  const k = ctx.getTransform().a || 1;
  const off = document.createElement('canvas');
  off.width = Math.ceil(w * k);
  off.height = Math.ceil(h * k);
  const c = off.getContext('2d')!;
  c.setTransform(k, 0, 0, k, 0, 0);

  // Setup shared by every layer of the line: origin at the first segment's
  // foot, horizontal stretch applied.
  const setup = (cc: CanvasRenderingContext2D, scale = k) => {
    cc.setTransform(scale, 0, 0, scale, 0, 0);
    cc.translate(pad, pad + m.ascent);
    cc.scale(s.stretch, 1);
    cc.textBaseline = 'alphabetic';
    cc.lineJoin = 'round';
    cc.miterLimit = 2;
  };
  const paint = (cc: CanvasRenderingContext2D, how: 'fill' | 'stroke') => {
    m.segs.forEach((seg, j) => {
      applyFont(cc, { ...s, size: m.sizes[j] });
      cc.save();
      cc.translate(m.offsets[j], 0);
      stretchSeg(cc, seg.stretchMul ?? 1, s.slant);
      if (how === 'fill') cc.fillText(seg.text, 0, 0);
      else cc.strokeText(seg.text, 0, 0);
      cc.restore();
    });
  };

  setup(c);

  // 1. Concentric borders, outermost to innermost. The stroke being centred on
  //    the contour, the width is twice the offset wanted; each pass covers the
  //    previous one inwards. They go on their own layer: it is that layer, and
  //    only it, that is then punched over the counters.
  const bord = document.createElement('canvas');
  bord.width = off.width;
  bord.height = off.height;
  const bc = bord.getContext('2d')!;
  setup(bc);
  //    Never on the subtitle: the counter of the D in "DERBY" is solid white
  //    in the source.
  const core = COUNTER_CORE !== 'source' && s.punchCounters && cum.length > 1 && cum[cum.length - 2] > 0;
  const tint = (cc: CanvasRenderingContext2D, scale: number) => {
    const bd = o.borders[o.borders.length - 2];
    setup(cc, scale);
    const g = cc.createLinearGradient(0, -m.ascent, 0, 0);
    g.addColorStop(0, bd.colors[0]);
    g.addColorStop(1, bd.colors[1]);
    cc.fillStyle = g;
    cc.fillRect(-1e4, -1e4, 2e4, 2e4);
  };
  for (let i = o.borders.length - 1; i >= 0; i--) {
    if (cum[i] <= 0) continue;
    const [c0, c1] = o.borders[i].colors;
    const bg = bc.createLinearGradient(0, -m.ascent, 0, 0);
    bg.addColorStop(0, c0);
    bg.addColorStop(1, c1);
    bc.lineWidth = cum[i] * 2;
    bc.strokeStyle = bg;
    //    The outermost border is blurred instead of stroked hard, so the logo
    //    ends on a glow rather than a crisp edge. Only its outward half shows:
    //    the inner passes are drawn after it and cover the spread it sends the
    //    other way. The radius is scaled by `k` because the canvas filter works
    //    in device pixels while everything else here is in layout pixels.
    bc.filter = i === o.borders.length - 1 && OUTER_BLUR > 0
      ? `blur(${s.size * OUTER_BLUR * k}px)` : 'none';
    paint(bc, 'stroke');
    bc.filter = 'none';
    //    The punch slips in HERE, right after the outer border is laid down
    //    and before the next one enters the hole: that border alone plugs it,
    //    and this is the only moment its white is still pure in there.
    if (core && COUNTER_CORE === 'open' && i === o.borders.length - 1) {
      fixCounters(bc, setup, paint, tint, cum[cum.length - 2], w, h);
    }
  }
  if (core && COUNTER_CORE === 'ink') {
    fixCounters(bc, setup, paint, tint, cum[cum.length - 2], w, h);
  }
  c.setTransform(k, 0, 0, k, 0, 0);
  c.drawImage(bord, 0, 0, w, h);

  // 2. Fill and halftone, ONE SEGMENT AT A TIME on its own scratch layer, then
  //    composited in order. The halftone is laid with `source-atop`, so on a
  //    shared layer it landed on whatever ink was already there -- including the
  //    neighbouring segment's. Its x-band is computed from the segment's
  //    advance, but the font leans 12 deg, so segment 1's ink overhangs the band
  //    to the right at the top and segment 2's to the left at the foot. At the
  //    junction each segment stippled the other with its own colour. Giving each
  //    segment a layer of its own confines `source-atop` to that segment's ink
  //    by construction. Compositing in order keeps the previous behaviour where
  //    the glyphs themselves overlap: the later segment wins.
  const fill = document.createElement('canvas');
  fill.width = off.width;
  fill.height = off.height;
  const fc = fill.getContext('2d')!;
  const one = document.createElement('canvas');
  one.width = off.width;
  one.height = off.height;
  const oc = one.getContext('2d')!;

  const period = s.size * HALFTONE_PERIOD;
  // Past half a pitch the dots touch and the screen degenerates into bands.
  const rMax = period * 0.52;
  // The band is widened by the slant's horizontal reach: the ink of a leaning
  // letter runs past the advance it was measured on.
  const lean = Math.abs(Math.tan((s.slant * Math.PI) / 180)) * (m.ascent + m.descent);

  m.segs.forEach((seg, i) => {
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.clearRect(0, 0, one.width, one.height);
    oc.setTransform(k, 0, 0, k, 0, 0);

    //    Ramp calibrated on the logo: the upper colour holds until 48 % of the
    //    height, the transition happens between 48 % and 86 %.
    oc.save();
    oc.translate(pad, pad + m.ascent);
    oc.scale(s.stretch, 1);
    oc.textBaseline = 'alphabetic';
    // The gradient follows the segment's OWN height: in the logo the initial
    // runs its whole ramp over its own height, not the word's.
    const g = oc.createLinearGradient(0, -m.ascents[i], 0, 0);
    g.addColorStop(0, seg.gradient[0]);
    g.addColorStop(GRAD_START, seg.gradient[0]);
    g.addColorStop(GRAD_END, seg.gradient[1]);
    g.addColorStop(1, seg.gradient[1]);
    oc.fillStyle = g;
    applyFont(oc, { ...s, size: m.sizes[i] });
    oc.translate(m.offsets[i], 0);
    stretchSeg(oc, seg.stretchMul ?? 1, s.slant);
    oc.fillText(seg.text, 0, 0);
    oc.restore();

    // 3. Halftone screen. In the logo the dots are born at the start of the
    //    gradient, grow, then merge into a flat at the end: their radius follows
    //    the descent through the ramp, it is not constant.
    if (s.halftone) {
      // The lattice stays anchored on the advance-based origin and is merely
      // extended outwards by whole periods: shifting the origin itself would
      // move every dot in the line, not just add the missing ones.
      const xa = pad + m.offsets[i] * s.stretch;
      const xb = pad + (m.offsets[i] + m.widths[i]) * s.stretch;
      const over = Math.ceil(lean / period) * period;
      const top = pad;
      oc.save();
      oc.globalCompositeOperation = 'source-atop';
      oc.fillStyle = seg.gradient[1];
      let row = 0;
      for (let yy = top; yy < top + m.ascent + m.descent; yy += period, row++) {
        const t = (yy - top) / m.ascent;
        const u = Math.min(1, Math.max(0, (t - GRAD_START) / (GRAD_END - GRAD_START)));
        const r = rMax * u;
        if (r < 0.3) continue;
        // The dots fade as they shrink: without that they would appear all at
        // once at the top of the ramp.
        oc.globalAlpha = Math.min(1, u * DOT_FADE);
        const shift = (row % 2) * period / 2;
        for (let xx = xa - period + shift - over; xx < xb + period + over; xx += period) {
          oc.beginPath();
          oc.arc(xx, yy, r, 0, Math.PI * 2);
          oc.fill();
        }
      }
      oc.restore();
    }

    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.drawImage(one, 0, 0);
  });

  c.drawImage(fill, 0, 0, w, h);

  // 4. Compose onto the target canvas.
  ctx.drawImage(off, x - pad, y - pad - m.ascent, w, h);
}
