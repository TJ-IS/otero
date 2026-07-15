import { Link, NavLink, Outlet } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { ArrowLeft, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TABS = [
  { to: '/docs/api', label: 'API' },
  { to: '/docs/agents', label: 'AGENTS.md' },
];

export function DocsLayout() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
        <Button variant="ghost" size="sm" asChild className="shrink-0 text-muted-foreground">
          <Link to="/">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-sm font-medium tracking-tight">开放 API 文档</h1>

        <nav className="ml-2 flex items-center gap-1 rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                cn(
                  'inline-flex items-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all',
                  isActive
                    ? 'bg-background text-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="切换主题"
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>

      <Outlet />
    </div>
  );
}
