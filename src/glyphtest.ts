/**
 * Development only: pages of firmware-font glyphs that might draw text
 * candles, to check on the glasses that they look as in the simulator. Each
 * line is a number, the glyph alone, three in a row, then one between `l`
 * strokes to show its advance.
 */
const GLYPHS = [...'▍▌▋▊▉▁▂▃▄▅▇█▔▕▆▐▓┃│‖━─'];
const PER_PAGE = 8;

export const GLYPH_PAGES: string[] = Array.from({ length: Math.ceil(GLYPHS.length / PER_PAGE) }, (_, p) =>
  GLYPHS.slice(p * PER_PAGE, (p + 1) * PER_PAGE)
    .map((g, i) => `${p * PER_PAGE + i + 1}: ${g}  ${g.repeat(3)}  l${g}l`)
    .join('\n'));
