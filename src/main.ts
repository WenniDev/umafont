import './style.css';
import { DEFAULT_SPEC, FONT_DISPLAY, FONT_SUBTITLE,
         INITIAL_SCALE, INITIAL_STRETCH, SUB_SIZE_RATIO,
         type Border, type LogoSpec, type Segment } from './logo';
import { loadFont, normalize, renderLogo } from './render';

const el = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;

const canvas = el<HTMLCanvasElement>('canvas');
const status = el<HTMLParagraphElement>('status');

// --- border panel, one row per concentric layer ---
const borderHost = el<HTMLDivElement>('borderControls');
const BORDER_SETS: [string, string, Border[]][] = [
  ['mb', 'Wordmark', DEFAULT_SPEC.mainOutline.borders],
  ['sb', 'Subtitle', DEFAULT_SPEC.subOutline.borders],
];
for (const [prefix, title, list] of BORDER_SETS) {
  const head = document.createElement('p');
  head.className = 'subhead';
  head.textContent = title;
  borderHost.appendChild(head);
  // listed outermost to innermost, the order they are seen in
  for (let i = list.length - 1; i >= 0; i--) {
    const label = i === list.length - 1 ? 'Outer' : i === 0 ? 'Inner' : 'Middle';
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <label>${label}</label>
      <input type="color" id="${prefix}_a${i}" value="${list[i].colors[0]}" title="top" />
      <input type="color" id="${prefix}_b${i}" value="${list[i].colors[1]}" title="bottom" />`;
    borderHost.appendChild(row);
  }
}

// Only the colours are adjustable: the widths are measured off the logo.
function borders(prefix: string, defaults: Border[]): Border[] {
  return defaults.map((b, i) => ({
    colors: [(el(`${prefix}_a${i}`) as HTMLInputElement).value,
             (el(`${prefix}_b${i}`) as HTMLInputElement).value] as [string, string],
    width: b.width,
  }));
}

/** Wordmark composition size: it sets the resolution of the render. */
const MAIN_SIZE = DEFAULT_SPEC.mainStyle.size;

/** True for a cased letter typed in upper case; false for anything else. */
const isBig = (ch: string) => ch !== ch.toLowerCase() && ch === ch.toUpperCase();

/**
 * Wordmark segments. Size is driven by the CASE of what is typed: a letter in
 * upper case is enlarged, one in lower case keeps the running size. So "Umamusume"
 * gives the big U of the logo, and "UMA" would enlarge all three.
 *
 * The text is therefore no longer upper-cased on the way in -- the case IS the
 * instruction. Each run of same-case characters becomes one segment, upper-cased
 * only at that point since the fonts carry capitals alone. Digits, spaces and
 * punctuation have no case and stay at the running size.
 */
function mainSegments(): Segment[] {
  const grad = (a: string, b: string): [string, string] =>
    [(el(a) as HTMLInputElement).value, (el(b) as HTMLInputElement).value];
  const out: Segment[] = [];

  const push = (text: string, g: [string, string]) => {
    let i = 0;
    while (i < text.length) {
      const big = isBig(text[i]);
      let j = i;
      while (j < text.length && isBig(text[j]) === big) j++;
      const run = text.slice(i, j).toUpperCase();
      out.push(big
        ? { text: run, gradient: g, scale: INITIAL_SCALE, stretchMul: INITIAL_STRETCH }
        : { text: run, gradient: g });
      i = j;
    }
  };

  push((el('main1') as HTMLInputElement).value, grad('m1Top', 'm1Bottom'));
  push((el('main2') as HTMLInputElement).value, grad('m2Top', 'm2Bottom'));
  return out;
}

function buildSpec(): LogoSpec {
  const str = (id: string) => el(id).value;
  const on = (id: string) => (el(id) as HTMLInputElement).checked;

  return {
    mainSegments: mainSegments(),
    subSegments: [
      { text: normalize(str('sub')), gradient: [str('subTop'), str('subBottom')] },
    ],
    mainStyle: {
      family: FONT_DISPLAY,
      size: MAIN_SIZE,
      stretch: DEFAULT_SPEC.mainStyle.stretch, // belongs to the font, not a setting
      gap: 0,
      tracking: DEFAULT_SPEC.mainStyle.tracking,
      halftone: true, // belongs to the wordmark, not a setting
      slant: DEFAULT_SPEC.mainStyle.slant, punchCounters: true,
    },
    subStyle: { family: FONT_SUBTITLE, size: MAIN_SIZE * SUB_SIZE_RATIO, stretch: DEFAULT_SPEC.subStyle.stretch, gap: 0,
                tracking: DEFAULT_SPEC.subStyle.tracking, halftone: true,
                slant: DEFAULT_SPEC.subStyle.slant,
                punchCounters: DEFAULT_SPEC.subStyle.punchCounters },
    subPos: DEFAULT_SPEC.subPos,
    mainOutline: { borders: borders('mb', DEFAULT_SPEC.mainOutline.borders) },
    subOutline: { borders: borders('sb', DEFAULT_SPEC.subOutline.borders) },
    transparent: on('transparent'),
    bgColor: str('bgColor'),
  };
}

function render() {
  const { width, height } = renderLogo(canvas, buildSpec());
  status.textContent = `${width} × ${height} px`;
}

document.getElementById('panel')!.addEventListener('input', render);

// The button restores the logo's palette only: the text, the enlarged initial
// and the effect toggles all survive it.
//
// The target is read from `defaultValue` -- the `value` attribute written in the
// markup -- and not from a snapshot taken when this module runs. A snapshot
// drifts: browsers restore form fields across a reload, so after one the
// module would capture the colours the user had just picked and adopt them as
// the values to "reset" to. `defaultValue` is never touched by user input.
// The border swatches are built by this file further up with their default
// colour in the markup, so they are covered the same way.
el<HTMLButtonElement>('reset').addEventListener('click', () => {
  for (const i of document.querySelectorAll<HTMLInputElement>('#panel input[type="color"]')) {
    i.value = i.defaultValue;
  }
  render();
});

el<HTMLButtonElement>('download').addEventListener('click', () => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = normalize(el('main1').value + el('main2').value).toLowerCase().replace(/\s+/g, '-');
    a.download = `${name || 'logo'}.png`;
    // The anchor has to be in the document and the blob URL has to outlive the
    // click. Chrome commits the download during click(), so revoking straight
    // after happened to work there; Firefox and Safari queue the navigation and
    // reach an already-revoked URL -- an empty file, or none at all.
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, 'image/png');
});

el<HTMLButtonElement>('copy').addEventListener('click', async () => {
  try {
    // The promise is handed to ClipboardItem rather than awaited first: an await
    // resolves on a later task, by which point Safari no longer counts the click
    // as user activation and the write throws NotAllowedError every time.
    const blob = new Promise<Blob>((res, rej) => canvas.toBlob(
      (b) => (b ? res(b) : rej(new Error('render unavailable'))), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    status.textContent = 'Copied to the clipboard.';
  } catch {
    status.textContent = "Copy failed — use the download button instead.";
  }
});

loadFont().then(render).catch(() => {
  status.textContent = 'The fonts could not be loaded.';
});
