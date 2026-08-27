// Chart color roles for the Dashboard, backed by the CSS custom properties
// defined in index.css (--chart-1..8, --chart-good/warning/serious/critical).
// Palette was validated with the dataviz skill's validate_palette.js against
// this project's actual light (#ffffff) and dark (#09090b) surfaces.
//
// Categorical hues are assigned in a FIXED order tied to each item type, not
// to rank — so a type keeps its color across renders/filters regardless of
// its count.

import i18n from '../i18n/index.js';

export const CATEGORICAL_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
  'hsl(var(--chart-7))',
  'hsl(var(--chart-8))',
];

export const STATUS_COLORS = {
  good: 'hsl(var(--chart-good))',
  warning: 'hsl(var(--chart-warning))',
  serious: 'hsl(var(--chart-serious))',
  critical: 'hsl(var(--chart-critical))',
};

// Fixed order for item types so color identity is stable regardless of
// count/rank. Matches web/src/lib/items.js ITEM_TYPES order.
export const ITEM_TYPE_COLOR_ORDER = [
  'journalArticle',
  'preprint',
  'book',
  'bookSection',
  'conferencePaper',
  'thesis',
  'report',
  'document',
];

export function colorForItemType(itemType) {
  const idx = ITEM_TYPE_COLOR_ORDER.indexOf(itemType);
  return CATEGORICAL_COLORS[idx >= 0 ? idx : CATEGORICAL_COLORS.length - 1];
}

// MinerU full-text parse state machine: idle|submitting|pending|running|
// converting|done|failed. Grouped into status roles. Labels via i18n.
export function getFulltextStateLabel(state) {
  if (!state) return '';
  const key = `dashboard:fulltextState.${state}`;
  const translated = i18n.t(key);
  return translated === key ? state : translated;
}

export const FULLTEXT_STATE_LABELS = new Proxy(
  {},
  {
    get(_, state) {
      return getFulltextStateLabel(state);
    },
  },
);

export function colorForFulltextState(state) {
  if (state === 'done') return STATUS_COLORS.good;
  if (state === 'failed') return STATUS_COLORS.critical;
  if (state === 'idle') return 'hsl(var(--muted-foreground))';
  return STATUS_COLORS.warning; // submitting/pending/running/converting
}

// One consistent hue for single-series magnitude charts (e.g. per-journal
// item counts, publication-year histogram) — these don't need categorical
// identity, just one readable color.
export const SINGLE_SERIES_COLOR = 'hsl(var(--chart-1))';
export const SINGLE_SERIES_COLOR_ALT = 'hsl(var(--chart-2))';
