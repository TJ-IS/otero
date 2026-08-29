import {
  Activity,
  BarChart3,
  Bot,
  CalendarRange,
  Code2,
  Copy,
  GitBranch,
  Gauge,
  HardDrive,
  Home,
  LibraryBig,
  Network,
  Newspaper,
  Search,
  Shield,
  Trash2,
  BookMarked,
} from 'lucide-react';

export const PRIMARY_NAV = [
  { to: '/', key: 'home', icon: Home, end: true },
  { to: '/library', key: 'library', icon: LibraryBig },
  { to: '/journals', key: 'journals', icon: Newspaper },
  { to: '/search', key: 'search', icon: Search },
  {
    to: '/dashboard',
    key: 'dashboard',
    icon: BarChart3,
    match: '/dashboard',
    childrenNs: 'dashboard',
    children: [
      { to: '/dashboard', labelKey: 'nav.overview', icon: Gauge, end: true },
      { to: '/dashboard/journals', labelKey: 'nav.journals', icon: Newspaper },
      { to: '/dashboard/timeline', labelKey: 'nav.timeline', icon: CalendarRange },
      { to: '/dashboard/authors', labelKey: 'nav.authors', icon: Network },
      { to: '/dashboard/merkle', labelKey: 'nav.merkle', icon: GitBranch },
    ],
  },
  {
    to: '/docs/api',
    key: 'openApi',
    icon: BookMarked,
    match: '/docs',
    childrenNs: 'docs',
    children: [
      { to: '/docs/api', labelKey: 'nav.api', icon: Code2 },
      { to: '/docs/agents', labelKey: 'nav.agents', icon: Bot },
    ],
  },
  {
    to: '/admin',
    key: 'admin',
    icon: Shield,
    match: '/admin',
    editorsOnly: true,
    childrenNs: 'admin',
    children: [
      { to: '/admin', labelKey: 'nav.status', icon: Activity, end: true },
      { to: '/admin/duplicates', labelKey: 'nav.duplicates', icon: Copy },
      { to: '/admin/reconcile', labelKey: 'nav.reconcile', icon: HardDrive },
      { to: '/admin/trash', labelKey: 'nav.trash', icon: Trash2 },
    ],
  },
];

export function isNavActive(item, pathname) {
  if (item.match) return pathname === item.match || pathname.startsWith(`${item.match}/`);
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
