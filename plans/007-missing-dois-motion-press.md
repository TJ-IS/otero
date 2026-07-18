# 007 — Gate MissingDoisModal row press with motion-press

- **Status**: DONE
- **Commit**: e19e9bd
- **Severity**: LOW
- **Category**: Accessibility
- **Estimated scope**: 1 file (`MissingDoisModal.jsx`)

## Problem

Copyable DOI rows use ungated `active:scale-[0.99]`. Touch devices can get sticky/odd press scaling. The design system already gates press scale behind fine pointers.

```jsx
/* web/src/components/dashboard/MissingDoisModal.jsx:154 — current */
className="group absolute left-0 flex w-full items-center justify-between gap-3 px-3 text-left font-mono text-xs transition-colors hover:bg-muted/60 active:scale-[0.99]"
```

## Target

Replace `active:scale-[0.99]` with `motion-press` (keeps `transition-colors hover:bg-muted/60`).

```jsx
/* target */
className="motion-press group absolute left-0 flex w-full items-center justify-between gap-3 px-3 text-left font-mono text-xs transition-colors hover:bg-muted/60"
```

Existing utility (do not redefine):

```css
/* web/src/index.css:89-96 */
@media (hover: hover) and (pointer: fine) {
  .motion-press {
    transition: transform var(--motion-duration-press) var(--motion-ease-out), ...;
  }
  .motion-press:active {
    transform: scale(0.97);
  }
}
```

Values: **120ms**, **scale(0.97)**, **cubic-bezier(0.23, 1, 0.32, 1)**.

Note: row also uses `transform: translateY(...)` for virtualization. `:active { transform: scale(0.97) }` can override the inline translate and jump the row visually.

**Required handling** (pick one, prefer A):

- **A (preferred):** Skip scale on virtualized rows — only remove `active:scale-[0.99]` and do **not** add `motion-press` if it fights `translateY`. Document in the PR that press feedback was removed to protect virtualization transforms.
- **B:** Wrap inner content in a span with `motion-press` so the outer button keeps `transform: translateY(...)` for the virtualizer:

```jsx
<button style={{ transform: `translateY(${row.start}px)`, ... }} className="group absolute ... transition-colors hover:bg-muted/60">
  <span className="motion-press flex w-full items-center justify-between gap-3">
    ...
  </span>
</button>
```

Do not leave both inline `translateY` and `:active` scale on the same element.

## Repo conventions to follow

- Exemplar: `web/src/components/ui/button.jsx:8`.
- Virtualizer pattern: keep `transform: translateY(${row.start}px)` on the positioned row root.

## Steps

1. Inspect the button: if it has inline `transform: translateY`, implement option B (inner `motion-press`) or A (remove scale only).
2. Remove ungated `active:scale-[0.99]`.
3. Confirm copy-on-click still works.

## Boundaries

- Do NOT change virtualizer measurements (`ROW_HEIGHT`, `getTotalSize`).
- Do NOT add new CSS classes beyond `motion-press`.
- Do NOT alter toast copy feedback for copy-one / copy-all.

## Verification

- **Mechanical**: open Missing DOIs modal; list scrolls; click copies DOI.
- **Feel check**:
  - Fine pointer: press feedback ~120ms scale on the interactive surface without row jumping in the list.
  - Touch: no erroneous hover/scale stickiness.
- **Done when**: no ungated `active:scale-*` on the row; virtualization transform intact.
