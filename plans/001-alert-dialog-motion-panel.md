# 001 — Wire AlertDialog into reduced-motion panel tokens

- **Status**: DONE
- **Commit**: e19e9bd
- **Severity**: HIGH
- **Category**: Accessibility
- **Estimated scope**: 1 file, ~2 className edits

## Problem

Destructive confirms (delete item, empty trash, discard edits) use `AlertDialog`, but its overlay/content omit the `motion-panel` class that `Dialog` already has. Under `prefers-reduced-motion: reduce`, `web/src/index.css` only rewrites `.motion-panel` animations to short fades — AlertDialog keeps full zoom/slide motion.

```jsx
/* web/src/components/ui/alert-dialog.jsx:17 — current Overlay */
'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
```

```jsx
/* web/src/components/ui/alert-dialog.jsx:31 — current Content (excerpt) */
'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in ...'
```

Compare Dialog, which already prefixes both with `motion-panel`:

```jsx
/* web/src/components/ui/dialog.jsx:21 — exemplar Overlay */
"motion-panel fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in ..."
```

## Target

Both AlertDialog Overlay and Content class strings start with `motion-panel`, matching Dialog. No other visual change in the default (non-reduced) path.

```jsx
/* target Overlay */
'motion-panel fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
```

```jsx
/* target Content — prepend motion-panel; keep existing duration/zoom/slide classes */
'motion-panel fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in ...'
```

## Repo conventions to follow

- Reduced-motion panel handling lives in `web/src/index.css` under `@media (prefers-reduced-motion: reduce)` for `.motion-panel` (`animation-duration: 120ms`, swap to `motion-fade-in` / `motion-fade-out`).
- Exemplar: `web/src/components/ui/dialog.jsx:21` and `:34`.

## Steps

1. In `web/src/components/ui/alert-dialog.jsx`, prepend `motion-panel ` to the Overlay `className` string (line ~17).
2. Prepend `motion-panel ` to the Content `className` string (line ~31).
3. Do not change AlertDialog API, markup, or button variants.

## Boundaries

- Do NOT touch `dialog.jsx`, `sheet.jsx`, or `index.css` in this plan.
- Do NOT change duration/easing tokens here (that is plan 002).
- Do NOT add dependencies.
- If `alert-dialog.jsx` already has `motion-panel` at the stamped commit’s successors, STOP and report.

## Verification

- **Mechanical**: from `web/`, run whatever lint/typecheck the repo uses for that package (at minimum ensure the file still parses); no new imports required.
- **Feel check**:
  - Open any AlertDialog (e.g. delete item in library detail, or Admin → Trash → Empty trash). Confirm open/close still feels like Dialog (zoom ~0.95 + fade, ~200ms).
  - In DevTools → Rendering → emulate `prefers-reduced-motion: reduce`. Re-open the same dialog: movement (zoom/slide) must drop; opacity fade ≤120ms remains.
  - Animations panel at 10% playback: reduced path uses fade-only keyframes, not zoom-in-95.
- **Done when**: Overlay and Content both include `motion-panel`, and reduced-motion path matches Dialog behavior.
