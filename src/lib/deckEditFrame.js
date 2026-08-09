import RUNTIME from './deckEditorRuntime.js?raw'

/**
 * Glue between the React editor and the deck's sandboxed iframe.
 *
 * The one idea worth stating plainly, because everything else follows from it:
 *
 *   THE DECK IFRAME IS ALWAYS LAID OUT AT FULL BOARD SIZE AND THEN SCALED DOWN
 *   WITH A CSS TRANSFORM. It is never given a smaller width and height.
 *
 * Decks size themselves with `vmin` and `clamp(19px, 3.7vmin, 42px)`. Those
 * resolve against the iframe's own viewport, so an iframe that is 900px wide
 * renders a genuinely different slide from the 1920px board it will be taught
 * on — different type size, different wrap points, and `clamp()` floors that
 * only bite at one of the two sizes. That is precisely why editing a deck in a
 * normal preview pane is trial and error.
 *
 * A `transform: scale()` changes none of that: layout happens at board pixels,
 * the raster is then drawn smaller. What you see is the presentation, shrunk.
 */

/** Aspect presets offered in the toolbar. `screen` is the default because the
 *  presenter board has no aspect cap of its own — it takes the whole viewport,
 *  so "presentation proportions" means the proportions of the display the deck
 *  is actually taught on. */
export const ASPECTS = [
  { id: 'screen', label: 'This screen' },
  { id: '16:9', label: '16 : 9', w: 16, h: 9 },
  { id: '16:10', label: '16 : 10', w: 16, h: 10 },
  { id: '4:3', label: '4 : 3', w: 4, h: 3 },
  { id: 'window', label: 'Browser window' },
]

/**
 * The pixel size the deck should believe it is being rendered at.
 *
 * Not just an aspect ratio — the absolute number matters. `clamp(19px, …, 42px)`
 * behaves differently at 1280 and at 1920, so guessing the ratio but not the
 * size still lies to the teacher. Screen dimensions are read in device-
 * independent pixels, which is what the presenter's iframe viewport reports too.
 */
export function boardSize(aspectId) {
  const scr = typeof window === 'undefined' ? null : window.screen
  if (aspectId === 'screen' && scr?.width && scr?.height) {
    return { w: Math.round(scr.availWidth || scr.width), h: Math.round(scr.availHeight || scr.height) }
  }
  if (aspectId === 'window') {
    return { w: Math.round(window.innerWidth), h: Math.round(window.innerHeight) }
  }
  const preset = ASPECTS.find((a) => a.id === aspectId)
  if (preset?.w) {
    // Anchor on the long edge of the real screen so the absolute size stays
    // honest even when the ratio is overridden.
    const long = Math.max(1280, Math.round(scr?.width || 1920))
    return { w: long, h: Math.round((long * preset.h) / preset.w) }
  }
  return { w: 1920, h: 1080 }
}

/** How much to shrink a `w x h` board so it fits inside `boxW x boxH`. */
export function fitScale(w, h, boxW, boxH) {
  if (!(w > 0 && h > 0 && boxW > 0 && boxH > 0)) return 1
  return Math.min(boxW / w, boxH / h)
}

/**
 * The document handed to the iframe: the deck exactly as authored, followed by
 * the editor runtime — the same shape as the presenter's `deckController`, so
 * a deck that loads in one loads in the other.
 */
export function buildEditorSrcdoc(deckHtml) {
  // `</script>` anywhere in the runtime text would close this tag early. It
  // does not appear today; escaping it means a future edit to the runtime
  // cannot silently truncate the editor.
  const safe = RUNTIME.replace(/<\/script/gi, '<\\/script')
  return `${deckHtml}\n<script data-lfe-own="1">\n${safe}\n</script>`
}

/** True when the text is something the presenter would accept as a deck. */
export function countPages(html) {
  try {
    return new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.page').length
  } catch {
    return 0
  }
}
