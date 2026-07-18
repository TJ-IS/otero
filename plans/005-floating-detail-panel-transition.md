# 005 — Convert FloatingDetailPanel open/close to CSS transitions

- **Status**: DONE
- **Commit**: e19e9bd
- **Severity**: MEDIUM
- **Category**: Interruptibility
- **Estimated scope**: 2 files (`FloatingDetailPanel.jsx`, `index.css`)

## Problem

The library detail panel uses Radix Dialog + `animate-in` / `animate-out` keyframes. Rapid open/close (select item → dismiss → select another) restarts keyframes from frame 0. ChatPanel already solves this with transitions + `data-state`.

```jsx
/* web/src/components/FloatingDetailPanel.jsx:21-32 — current */
<DialogPrimitive.Overlay className="motion-panel fixed inset-0 z-20 bg-black/20 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
<DialogPrimitive.Content
  className={cn(
    'motion-panel fixed z-30 flex outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 [animation-timing-function:var(--motion-ease-drawer)]',
    isMobile
      ? 'inset-x-0 bottom-0 top-0 data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4'
      : 'right-3 top-3 bottom-3 data-[state=open]:slide-in-from-right-full data-[state=closed]:slide-out-to-right-full',
  )}
```

## Target

Mirror ChatPanel’s presence + transition pattern while **keeping** Radix Dialog for focus trap / portal / Escape.

Tokens:

```css
--motion-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
--motion-duration-panel: 220ms;
--motion-duration-popover: 160ms;
```

**CSS** (add beside `.chat-panel` in `web/src/index.css`):

```css
.detail-panel-scrim {
  opacity: 0;
  transition: opacity var(--motion-duration-popover) ease-out;
}
.detail-panel-scrim[data-state='open'] {
  opacity: 1;
}

.detail-panel {
  opacity: 0;
  transition:
    transform var(--motion-duration-panel) var(--motion-ease-drawer),
    opacity 160ms ease-out;
}
.detail-panel[data-mobile='false'] {
  transform: translateX(100%);
}
.detail-panel[data-mobile='true'] {
  transform: translateY(100%);
}
.detail-panel[data-state='open'] {
  opacity: 1;
  transform: translateX(0) translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .detail-panel {
    transform: none;
    transition: opacity var(--motion-duration-popover) ease-out;
  }
}
```

**JS** — same structure as `ChatPanel.jsx:97-113`:

- When `open` becomes true: mount (`panelPresent=true`), rAF → `data-state='open'`.
- When `open` becomes false: `data-state='closed'`, after **220ms** unmount (`panelPresent=false`).
- Use Radix `forceMount` on Content/Overlay while `panelPresent`, driven by controlled `open` OR keep Root `open={panelPresent}` so exit can play — pick one approach and keep focus restore (`previouslyFocused`) working.
- Remove `animate-in` / `slide-in-from-*` / `animate-out` classes from Overlay/Content; use `detail-panel-scrim` / `detail-panel` + `data-state` + `data-mobile`.

Desktop still uses inline `style={{ width }}`. Mobile full-bleed inset unchanged.

## Repo conventions to follow

- Exemplar: `web/src/components/ChatPanel.jsx:97-113` + `.chat-panel` / `.chat-scrim` in `web/src/index.css:103-121`.
- Close timeout must match `--motion-duration-panel` (220ms), as ChatPanel uses 220 for unmount delay.
- Keep `motion-panel` **or** rely on the new reduced-motion rules for `.detail-panel` — do not leave orphaned animate-in classes.

## Steps

1. Add `.detail-panel` / `.detail-panel-scrim` (+ reduced-motion) to `web/src/index.css`.
2. Refactor `FloatingDetailPanel.jsx` to presence state + `data-state`, strip keyframe animation classes.
3. Confirm Escape / overlay click / mobile back still call `onClose`.
4. Confirm `onCloseAutoFocus` still restores focus.

## Boundaries

- Do NOT change ItemDetail contents or LibraryView selection logic.
- Do NOT animate `width` during open/close (width resize handle stays as today).
- Do NOT add Framer Motion.
- Do NOT alter z-index stacking relative to ChatPanel (detail z-20/30, chat z-40/50) unless a regression forces a documented one-line fix.

## Verification

- **Mechanical**: library → click row → panel opens; Esc closes; mobile sheet-like full screen works.
- **Feel check**:
  - Desktop: panel slides from the right in ~220ms with drawer curve; scrim fades ~160ms.
  - Spam open/close: motion retargets mid-flight (no snap back to off-screen start).
  - Switch selected item while open: panel stays open (no re-animate); only content swaps.
  - `prefers-reduced-motion: reduce`: opacity only, no translate.
  - DevTools 10%: confirm `transition` on transform/opacity, not `animation-name: enter`.
- **Done when**: no `animate-in` on this panel; interruptible transitions; a11y close/focus preserved.
