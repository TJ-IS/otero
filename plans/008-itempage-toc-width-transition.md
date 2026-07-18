# 008 — Bridge ItemPage TOC open/close layout jump

- **Status**: DONE
- **Commit**: e19e9bd
- **Severity**: — (missed opportunity / additive)
- **Category**: Missed opportunities
- **Estimated scope**: 1 file (`ItemPage.jsx`), optional tiny CSS utility

## Problem

Toggling the reading TOC snaps between `w-56`/`w-64` and `w-0`, so the article column jumps with no bridge.

```jsx
/* web/src/components/ItemPage.jsx:321-325 — current */
<aside
  className={cn(
    'hidden md:flex md:h-full flex-col border-r bg-muted/15 shrink-0',
    tocOpen ? 'w-56 xl:w-64' : 'w-0 border-r-0 overflow-hidden',
  )}
>
```

Frequency: occasional (reading a paper). Purpose: preventing a jarring change.

## Target

Keep overflow clipping; animate width with panel tokens. This is an intentional layout transition for an occasional control (overlay `transform` cannot reclaim the column gap cleanly).

```jsx
/* target */
<aside
  className={cn(
    'hidden md:flex md:h-full flex-col border-r bg-muted/15 shrink-0 overflow-hidden motion-toc',
    tocOpen ? 'w-56 xl:w-64' : 'w-0 border-r-0',
  )}
>
```

```css
/* add to web/src/index.css utilities */
.motion-toc {
  transition: width var(--motion-duration-panel) var(--motion-ease-drawer);
}
@media (prefers-reduced-motion: reduce) {
  .motion-toc {
    transition: none;
  }
}
```

Values:

- Duration: `var(--motion-duration-panel)` → **220ms**
- Easing: `var(--motion-ease-drawer)` → **cubic-bezier(0.32, 0.72, 0, 1)**

Ensure inner TOC content has a min-width matching the open width (e.g. wrap nav in `w-56 xl:w-64 shrink-0`) so text does not reflow/squash during the width animation.

Toggle control stays at `ItemPage.jsx:281-289` — no animation on the icon button beyond existing `motion-press` from `Button`.

## Repo conventions to follow

- Panel duration/easing tokens in `web/src/index.css:28-31`.
- Drawer curve already used for Sheet / chat panel lateral motion.

## Steps

1. Add `.motion-toc` (+ reduced-motion) to `web/src/index.css`.
2. Update the `<aside>` classes; add inner min-width wrapper if content squashes mid-transition.
3. Manually toggle TOC on `md+` breakpoints.

## Boundaries

- Do NOT animate TOC on mobile (`hidden md:flex` stays).
- Do NOT add stagger to TOC links.
- Do NOT change scroll-to-heading behavior.
- If you prefer `grid-template-columns` over `width`, that is acceptable only if reduced-motion still disables it and open widths remain `14rem` / `16rem` (`w-56` / `w-64`).

## Verification

- **Mechanical**: item page with structure → TOC toggle shows/hides outline.
- **Feel check**:
  - Open/close ~220ms; reading column eases instead of jumping.
  - Spam toggle: width retargets (CSS transition), no keyframe restart.
  - Reduced motion: instant width change.
  - DevTools 10%: watch width transition curve (drawer).
- **Done when**: no hard jump on TOC toggle; reduced-motion instant; tokens used.
