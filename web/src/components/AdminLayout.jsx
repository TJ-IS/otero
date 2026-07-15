import { Outlet, useNavigate, NavLink } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Moon, Sun, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

const TABS = [
  { to: '/admin', label: '系统状态', end: true },
  { to: '/admin/duplicates', label: '条目查重' },
  { to: '/admin/reconcile', label: '存储对账' },
  { to: '/admin/trash', label: '回收站' },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { canEdit } = useAuth();

  // Non-editors see a simple no-permission message
  if (!canEdit) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <ShieldCheck className="size-10 opacity-40" />
        <p className="text-sm">后台管理仅限白名单管理员访问</p>
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          返回文库
        </Button>
      </div>
    );
  }

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

        <ShieldCheck className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">后台管理</span>

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

      {/* Mobile tab row */}
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
