# 009 — Keep desktop library sidebar mounted and animate width

- **Status**: DONE
- **Commit**: e19e9bd
- **Severity**: — (missed opportunity / additive)
- **Category**: Missed opportunities
- **Estimated scope**: 1–2 files (`LibraryView.jsx`, optional `index.css`)

## Problem

Desktop sidebar is conditionally mounted, so the main list jumps when toggling.

```jsx
/* web/src/components/LibraryView.jsx:205-215 — current */
{sidebarOpen && !isMobile && (
  <aside className="hidden h-full shrink-0 border-r bg-background md:flex" style={{ width: SIDEBAR_WIDTH }}>
    <Sidebar ... onCollapse={() => setSidebarOpen(false)} />
  </aside>
)}
```

`SIDEBAR_WIDTH = 260` at `LibraryView.jsx:26`. Mobile already uses animated `Sheet` — leave that path alone.

Frequency: tens/day for power users → keep motion **short** (≤180ms), not celebratory.

## Target

Always mount the desktop aside on `md+`; drive width + overflow from `sidebarOpen`.

```jsx
/* target sketch */
{!isMobile && (
  <aside
    className={cn(
      'motion-library-sidebar hidden h-full shrink-0 border-r bg-background md:flex overflow-hidden',
      !sidebarOpen && 'border-r-0',
    )}
    style={{ width: sidebarOpen ? SIDEBAR_WIDTH : 0 }}
    aria-hidden={!sidebarOpen}
  >
    <div style={{ width: SIDEBAR_WIDTH }} className="flex h-full shrink-0">
      <Sidebar
        ...
        onCollapse={() => setSidebarOpen(false)}
      />
    </div>
  </aside>
)}
```

```css
.motion-library-sidebar {
  transition: width 180ms var(--motion-ease-drawer);
}
@media (prefers-reduced-motion: reduce) {
  .motion-library-sidebar {
    transition: none;
  }
}
```

Values:

- Duration: **180ms** (under 300ms UI budget; snappier than panel 220ms because toggle is more frequent)
- Easing: `var(--motion-ease-drawer)` → **cubic-bezier(0.32, 0.72, 0, 1)**

Inner fixed width `260px` prevents Sidebar contents from crushing during collapse. When `width: 0`, set `aria-hidden` and ensure focus cannot land inside (Sidebar collapse control already closes it).

TopBar `onToggleSidebar` / `sidebarOpen` props stay as today.

## Repo conventions to follow

- Mobile exemplar (already correct): `LibraryView.jsx:216-230` Sheet.
- Drawer easing token: `--motion-ease-drawer`.
- Do not animate the Sheet path again.

## Steps

1. Replace `{sidebarOpen && !isMobile && (...)}` with always-mounted desktop aside + width style.
2. Add `.motion-library-sidebar` CSS (or Tailwind arbitrary transition classes using the same token values).
3. Confirm collapse control, journal selection, and TopBar toggle still work.
4. When closed, clicking journal items should not be possible (overflow hidden + width 0); `pointer-events-none` when `!sidebarOpen` is recommended.

## Boundaries

- Do NOT change Sidebar filter logic or data fetching.
- Do NOT animate mobile Sheet differently.
- Do NOT introduce Framer Motion.
- Do NOT use durations > 200ms for this toggle.

## Verification

- **Mechanical**: desktop library → toggle sidebar from TopBar and from Sidebar collapse; journals still filter the table.
- **Feel check**:
  - Main column eases over ~180ms; no pop.
  - Spam toggle: width retargets smoothly.
  - Reduced motion: instant.
  - Mobile unchanged (Sheet).
- **Done when**: desktop sidebar not unmounted on close; width transition uses drawer ease ≤180ms; reduced-motion instant.
