# 003 — Make citation tooltips interruptible with transitions

- **Status**: DONE
- **Commit**: e19e9bd
- **Severity**: MEDIUM
- **Category**: Interruptibility
- **Estimated scope**: 1 file (`web/src/index.css`), CitationRef only if class names change

## Problem

In-text citation cards use a keyframe enter. Rapid hover/focus across citations restarts from `opacity: 0; scale(0.97)` every time instead of retargeting from the current value.

```css
/* web/src/index.css:127-140 — current */
.citation-tooltip {
  transform: var(--citation-translate);
  transform-origin: var(--citation-origin);
  animation: citation-tooltip-enter var(--motion-duration-popover) var(--motion-ease-out);
}

@keyframes citation-tooltip-enter {
  from { opacity: 0; transform: var(--citation-translate) scale(0.97); }
  to { opacity: 1; transform: var(--citation-translate) scale(1); }
}
```

`CitationRef.jsx` mounts the portal when `open` is true and sets `--citation-translate` / `--citation-origin` inline — keep that contract.

## Target

Use CSS transitions + `@starting-style` so enter is interruptible. Duration/easing from existing tokens:

- Duration: `var(--motion-duration-popover)` → **160ms**
- Easing: `var(--motion-ease-out)` → **cubic-bezier(0.23, 1, 0.32, 1)**
- Enter from: `opacity: 0` + `scale(0.97)` (never `scale(0)`)
- Animate only `opacity` and `transform`

```css
/* target */
.citation-tooltip {
  transform: var(--citation-translate) scale(1);
  transform-origin: var(--citation-origin);
  opacity: 1;
  transition:
    opacity var(--motion-duration-popover) var(--motion-ease-out),
    transform var(--motion-duration-popover) var(--motion-ease-out);
}

@starting-style {
  .citation-tooltip {
    opacity: 0;
    transform: var(--citation-translate) scale(0.97);
  }
}
```

Reduced-motion (replace the current keyframe swap):

```css
@media (prefers-reduced-motion: reduce) {
  .citation-tooltip {
    transition: opacity 120ms ease-out;
    transform: var(--citation-translate); /* no scale */
  }
  @starting-style {
    .citation-tooltip {
      opacity: 0;
      transform: var(--citation-translate);
    }
  }
}
```

Remove unused `@keyframes citation-tooltip-enter` and `citation-tooltip-fade` if nothing else references them after the edit.

Legacy fallback if `@starting-style` must be paired: keep a one-frame `data-mounted` attribute set in `CitationRef` via `useEffect` — only if you verify `@starting-style` is insufficient in the project’s supported browsers; prefer `@starting-style` alone first.

## Repo conventions to follow

- Tokens: `--motion-duration-popover`, `--motion-ease-out` in `web/src/index.css:27-30`.
- Spatial origin already correct via `--citation-origin` from `CitationRef.jsx:119-120`.
- Chat panel shows the preferred transition + `data-state` pattern (`web/src/index.css:103-111`) — same interruptibility goal.

## Steps

1. Rewrite `.citation-tooltip` in `web/src/index.css` to transition + `@starting-style` as above.
2. Update the reduced-motion `.citation-tooltip` block to opacity-only (drop keyframe reference).
3. Delete orphaned keyframes if unused.
4. Touch `CitationRef.jsx` only if a `data-mounted` fallback is required after feel-check fails in a target browser.

## Boundaries

- Do NOT change tooltip positioning math in `CitationRef.jsx` (`place`, CARD_WIDTH, portal).
- Do NOT animate `top`/`left`.
- Do NOT add motion libraries.
- Do NOT restyle tooltip chrome (border, shadow, typography).

## Verification

- **Mechanical**: open an item page with full text that has author-year cites; hover a cite — card appears.
- **Feel check**:
  - Enter: ~160ms, starts fast (ease-out), scales from 0.97 with correct origin (above/below trigger).
  - Whip the pointer across several cites quickly: opacity/scale should retarget smoothly, not flash from zero each time.
  - DevTools 10% playback: confirm no keyframe named `citation-tooltip-enter` on the element.
  - `prefers-reduced-motion: reduce`: fade only, no scale, ≤120ms.
- **Done when**: enter uses transition/`@starting-style`; keyframe enter path gone; reduced-motion is opacity-only.
