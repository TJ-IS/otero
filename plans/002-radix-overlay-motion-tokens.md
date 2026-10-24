# 002 — Align Select/Dropdown/Dialog motion tokens and press feedback

- **Status**: DONE
- **Commit**: e19e9bd
- **Severity**: HIGH (a11y) / MEDIUM (easing) / LOW (press) — one primitives pass
- **Category**: Accessibility + Easing & duration + Cohesion
- **Estimated scope**: 4 files (`select.jsx`, `dropdown-menu.jsx`, `dialog.jsx`, `index.css`)

## Problem

1. `motion-popover` is referenced in reduced-motion CSS but never applied in JSX — Select/Dropdown keep full zoom/slide under reduced motion.
2. Select/Dropdown/Dialog entrances use tailwindcss-animate defaults; Sheet already pins drawer easing. Dialog uses bare `duration-200` with no `--motion-ease-*`.
3. `SelectTrigger` lacks `motion-press` while `Button` has it.

```jsx
/* web/src/components/ui/select.jsx:55 — SelectContent (excerpt) */
"relative z-50 ... data-[state=open]:animate-in ... zoom-in-95 ... origin-[--radix-select-content-transform-origin]",
```

```jsx
/* web/src/components/ui/dropdown-menu.jsx:54 — DropdownMenuContent animation classes */
'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 ...';
```

```jsx
/* web/src/components/ui/select.jsx:17 — SelectTrigger — no motion-press */
'flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border ...';
```

```css
/* web/src/index.css:158-171 — motion-popover listed but only motion-panel gets name swap */
.motion-panel,
.motion-popover {
  animation-duration: 120ms !important;
  animation-timing-function: ease-out !important;
}
.motion-panel[data-state='open'] {
  animation-name: motion-fade-in !important;
}
.motion-panel[data-state='closed'] {
  animation-name: motion-fade-out !important;
}
```

## Target

Exact token values (already in `:root`):

```css
--motion-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--motion-duration-press: 120ms;
--motion-duration-popover: 160ms;
--motion-duration-panel: 220ms;
```

**SelectContent / DropdownMenuContent / DropdownMenuSubContent** — prepend `motion-popover`, pin duration + ease:

```
motion-popover ... [animation-duration:var(--motion-duration-popover)] [animation-timing-function:var(--motion-ease-out)]
```

Keep existing `animate-in` / `zoom-in-95` / `origin-[--radix-*-transform-origin]` / side slides. Do not use `scale(0)` / bare `zoom-in`.

**DialogContent** — keep `motion-panel`; replace bare `duration-200` with:

```
[animation-duration:var(--motion-duration-panel)] [animation-timing-function:var(--motion-ease-out)]
```

(Centered modal: ease-out, not drawer. Overlay can stay fade-only with default animate-in duration or the same panel duration.)

**SelectTrigger** — add `motion-press` at the start of the class string (same as Button).

**index.css** — under reduced-motion, give `.motion-popover` the same animation-name swap as `.motion-panel`:

```css
.motion-popover[data-state='open'] {
  animation-name: motion-fade-in !important;
}
.motion-popover[data-state='closed'] {
  animation-name: motion-fade-out !important;
}
```

## Repo conventions to follow

- Tokens: `web/src/index.css:27-31`.
- Drawer exemplar (easing pin pattern): `web/src/components/ui/sheet.jsx:39` — `[animation-timing-function:var(--motion-ease-drawer)]`.
- Press exemplar: `web/src/components/ui/button.jsx:8` — `motion-press` (already gated in CSS by `@media (hover: hover) and (pointer: fine)`).
- Keep Radix transform origins on popovers (`origin-[--radix-select-content-transform-origin]` etc.).

## Steps

1. `web/src/components/ui/select.jsx`: add `motion-press` to SelectTrigger classes; add `motion-popover`, `[animation-duration:var(--motion-duration-popover)]`, `[animation-timing-function:var(--motion-ease-out)]` to SelectContent.
2. `web/src/components/ui/dropdown-menu.jsx`: same three additions on `DropdownMenuContent` and `DropdownMenuSubContent`.
3. `web/src/components/ui/dialog.jsx`: on DialogContent, replace `duration-200` with `[animation-duration:var(--motion-duration-panel)] [animation-timing-function:var(--motion-ease-out)]`.
4. `web/src/index.css`: add `.motion-popover[data-state='open'|'closed']` animation-name overrides next to the existing `.motion-panel` ones.
5. Do not invent new cubic-beziers or duration tokens.

## Boundaries

- Do NOT rewrite animate-in to CSS transitions (that is plan 005 for FloatingDetailPanel only).
- Do NOT change AlertDialog here (plan 001).
- Do NOT add Framer Motion or other deps.
- Do NOT remove `zoom-in-95` in favor of `zoom-in` (DEFAULT scale is 0 — forbidden).

## Verification

- **Mechanical**: open LanguageSwitcher / any Select in ItemDetail; open a Dialog (e.g. Crossref). App builds.
- **Feel check**:
  - Select/Dropdown: enter ~160ms, strong ease-out, scale from trigger origin (not center). Spamming open/close should not feel sluggish (>250ms).
  - Dialog: ~220ms ease-out zoom from center (modal exemption).
  - SelectTrigger press: fine pointer → scale 0.97 in ~120ms; touch devices → no sticky hover scale.
  - `prefers-reduced-motion: reduce`: Select/Dropdown/Dialog drop zoom/slide; opacity fade ≤120ms.
- **Done when**: `motion-popover` appears on all three popover contents; Dialog uses panel duration token; SelectTrigger has `motion-press`; reduced-motion name swap covers `.motion-popover`.
