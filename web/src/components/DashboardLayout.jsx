import { Outlet, useNavigate, NavLink } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Moon, Sun, LayoutDashboard } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { to: '/dashboard', label: '概览', end: true },
  { to: '/dashboard/journals', label: '期刊详情' },
  { to: '/dashboard/timeline', label: '时间序列' },
  { to: '/dashboard/authors', label: '学者关系网络' },
  { to: '/dashboard/merkle', label: 'Merkle Tree' },
];

export function DashboardLayout() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          title="返回文库"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <LayoutDashboard className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">仪表盘</span>

        <nav className="ml-2 hidden items-center gap-1 rounded-lg bg-muted p-1 sm:flex">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'inline-flex items-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all',
                  isActive
                    ? 'bg-background text-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>

      {/* Below sm: tab row wraps under the header since there isn't room inline */}
      <nav className="flex items-center gap-1 overflow-x-auto border-b bg-muted/40 p-1.5 sm:hidden">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                'inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all',
                isActive
                  ? 'bg-background text-foreground shadow'
                  : 'text-muted-foreground hover:text-foreground'
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
