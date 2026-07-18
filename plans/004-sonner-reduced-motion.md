# 004 — Soften Sonner toasts under reduced motion

- **Status**: DONE
- **Commit**: e19e9bd
- **Severity**: MEDIUM
- **Category**: Accessibility (+ Performance for height)
- **Estimated scope**: 1–2 files (`web/src/index.css`, optionally `web/src/components/ui/sonner.jsx`)

## Problem

Toasts are mounted via `web/src/App.jsx` → `Toaster` from `web/src/components/ui/sonner.jsx`. Sonner’s default CSS animates `transform`, `opacity`, and **`height`** (~400ms) with no `prefers-reduced-motion` handling. Stacking toasts cause layout thrash; reduced-motion users still get slide/stack motion.

```jsx
/* web/src/components/ui/sonner.jsx:10-24 — current (styling only, no motion config) */
<Sonner
  theme={theme}
  className="toaster group"
  toastOptions={{
    classNames: {
      toast: "group toast group-[.toaster]:bg-background ...",
      ...
    },
  }}
  {...props}
/>
```

## Target

In `web/src/index.css` (utilities or a small components block), add:

```css
@media (prefers-reduced-motion: reduce) {
  [data-sonner-toaster] [data-sonner-toast],
  [data-sonner-toaster] [data-sonner-toast][data-mounted],
  [data-sonner-toaster] [data-sonner-toast][data-removed] {
    animation: none !important;
    transition-property: opacity !important;
    transition-duration: 120ms !important;
    transition-timing-function: ease-out !important;
    transform: none !important;
  }
}
```

If Sonner still animates `height` under reduce after the above, also force:

```css
@media (prefers-reduced-motion: reduce) {
  [data-sonner-toaster] [data-sonner-toast] {
    transition-property: opacity !important;
    /* prevent height from participating */
    height: auto !important;
  }
}
```

Optional (default path polish, only if feel-check shows 400ms is sluggish for this crisp app): in `sonner.jsx` pass `duration` for toast *lifetime* only if already desired — do **not** confuse lifetime with animation duration. Prefer CSS overrides for enter/exit. If Sonner exposes `toastOptions.classNames` hooks that help, keep changes minimal.

Do **not** set toast animation duration above 300ms for UI enter/exit in any override you add for the default (non-reduce) path. If you override default enter, use:

- `160ms` / `var(--motion-duration-popover)`
- `cubic-bezier(0.23, 1, 0.32, 1)` / `var(--motion-ease-out)`
- Prefer `transform` + `opacity` only (no `height` if you re-specify transition-property)

## Repo conventions to follow

- Reduced motion keeps gentle opacity, drops movement — see `.chat-panel` and `.motion-panel` blocks in `web/src/index.css:158-192`.
- Toast position stays `bottom-right` as in `App.jsx` (`<Toaster richColors position="bottom-right" />`).

## Steps

1. Add the reduced-motion Sonner override block to `web/src/index.css`.
2. Manually verify selectors against the live DOM (`[data-sonner-toast]` attributes) in DevTools; adjust selectors if Sonner version differs, but keep the same intent.
3. Optionally tighten default-path `transition-property` to exclude `height` **only if** you can do it without breaking stack positioning — if stack breaks, leave default path alone and only ship the reduce override.
4. Do not replace Sonner with another toast library.

## Boundaries

- Do NOT change toast copy, `richColors`, or call sites (`toast.success` etc.).
- Do NOT add Framer Motion.
- If CSS cannot reach Sonner internals without `!important` wars that break stacking, STOP and report with a screenshot/DOM dump — do not fork `node_modules`.

## Verification

- **Mechanical**: trigger any toast (e.g. copy link on item page, batch parse). Toast still appears bottom-right.
- **Feel check**:
  - Default: toast still readable; no multi-second sluggishness.
  - Emulate `prefers-reduced-motion: reduce`: toast fades ≤120ms, no slide/swipe transform; stacking should not animate height dramatically.
  - Rapid successive toasts (batch parse loading → success): no janky jump loop under reduce.
- **Done when**: reduced-motion path is opacity-first; default path still usable; no new dependencies.
