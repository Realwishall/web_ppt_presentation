# Why the board feels slow on the MaxHub

Written after an audit of `public/presenter.html` against a 4K MaxHub driven by
Chrome on its Windows OPS PC, with several folders loaded at once and the lag
showing up as **ink trailing the finger**.

The short version: the optimisation work already in the file is sound, but it
was aimed at the wrong input device. On a MaxHub the low-latency path was
switched off by the very check that was meant to protect it.

---

## 1. The finding that matches the symptom

`pointerrawupdate` is Chromium's early-delivery input event: points arrive as
the digitiser produces them instead of being held until the frame boundary.
The presenter listened for it — and then threw away everything that was not a
stylus:

```js
canvas.addEventListener("pointerrawupdate", e => {
  if (e.pointerType !== "pen") return;     // ← the whole problem
  …
});
```

**A MaxHub's IR touch frame reports `pointerType === "touch"`.** It is not a
digitiser pen and never claims to be. So on the one device this presenter
exists for, every raw point was discarded and the finger fell through to
`feedInk()`, which queues points and draws them from a `requestAnimationFrame`
callback — the frame-aligned path, chosen on purpose as the *slow, safe* one.

Both halves of the tuning therefore pointed the wrong way: the fast path was
reserved for a device that is not in the room, and the slow path was given to
the device that is.

The reason touch was excluded is real and worth keeping in mind — IR touch
fires 200+ times a second, and one `stroke()` per event against a canvas of
several megapixels does make ink feel sticky rather than fast. But that is a
reason to cap **how often the canvas is asked to draw**, not to hand a whole
frame back to the machine with the least to spare.

### What changed

Touch now takes the raw path as well, buffered and flushed at most once every
`RAW_MIN_MS` (6 ms). That is sub-frame latency at a submit rate the GPU can
hold — roughly 160 draws a second instead of 200+, versus 60 before. A pen is
still never buffered; it does not flood, and every millisecond is visible in
the nib.

`Shift+R` toggles it and the choice is remembered, so it can be A/B'd on the
panel itself and reverted in a keypress if this panel disagrees.

---

## 2. Measure before changing anything else

`public/panel-bench.html` ships alongside the presenter. Open it **on the
panel**, from the same address as the app (`…/panel-bench.html`, so it can read
the board's saved settings), in the same Chrome, full screen.

It answers three questions that cannot be answered from a laptop:

- **Section 1 — what this panel is.** GPU string, real pixel count, and the
  presenter's own decisions replayed: whether big-panel (lite) mode turns on
  here, whether a saved preference is overriding it, and what size the ink
  surface ends up.
- **Section 2 — which layer costs the frames.** Frame *interval* is clamped to
  the refresh rate and canvas calls return before the GPU has done anything, so
  neither can be timed directly. Instead each configuration is run at rising
  load until it starts missing frames, and the last level it survived is its
  score. Comparing two scores is comparing how much of the panel each layer
  eats: the rounded board, the `desynchronized` flag, one deck iframe, eight
  deck iframes.
- **Section 3 — how far the ink actually lags.** Two boards side by side, one
  on the old frame-batched path and one on the raw path, both measuring from
  the OS timestamp on the touch to the frame that carries the ink. Scribble on
  both for five seconds. If the raw box is not faster on this panel, press
  `Shift+R` in the presenter and the change above is undone.

---

## 3. Things to check on the panel before blaming the code

**Is Chrome using the GPU at all?** `chrome://gpu` — if it says SwiftShader or
software rendering anywhere in the top block, nothing in this document matters
and no code change will help. OPS PCs ship with display drivers that Chrome
blocklists more often than you would expect.

**Is big-panel mode actually on?** It is automatic above a pixel threshold, but
`Shift+P` sets a preference that is remembered *and overrides the automatic
choice permanently on that browser profile*. If someone once pressed it off,
the 4K budget has been skipped ever since. The bench reports which state the
panel is in.

**Is the panel's own smoothing in the way?** MaxHub firmware applies its own
prediction and smoothing to IR touch, with its own latency, and it varies by
"writing mode" / "touch mode" in the panel's settings menu. It sits underneath
the browser and no web code can remove it. If section 3 of the bench reports
80 ms and up, look there before looking here.

---

## 4. The ceiling, honestly

There is a floor to how fast this can be made, and it is worth naming so the
next round of tuning does not chase it.

A native whiteboard app on one of these panels talks to the touch driver and
the display more or less directly. This presenter is a full-board ink canvas
composited over a **live sandboxed iframe** — the deck — inside a browser,
at 4K, on integrated graphics. Every ink frame has to combine at least two
compositor surfaces before it reaches the glass, and every touch has to cross
the panel firmware, the OS, Chrome's input pipeline and a JavaScript handler
before it becomes a line.

A browser board on this hardware lands somewhere around 30–50 ms of
finger-to-ink delay when everything is right. A native one lands near 15. The
work above is about being at the good end of that band, not about leaving it.

The one structural cost still on the table is **loading several folders at
once**. Each deck is its own `srcdoc` iframe with `sandbox="allow-scripts"`,
which gives it an opaque origin, which gives it its own renderer process in
Chrome. A whole chapter loaded up front is five to fifteen processes alive for
the lesson, and they are never unloaded. Section 2 of the bench prices that
directly (1 deck vs 4 vs 8). If the number is large, the cheap fix is
behavioural — load a folder at a time — and the real fix is to tear down the
iframe of a deck that is not the active one and rebuild it from `deck.text`
when it comes back, which is a change worth making only once the bench says
it is worth making.
