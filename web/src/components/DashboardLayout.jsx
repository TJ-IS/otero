import { Outlet, useNavigate, NavLink, useLocation } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Moon, Sun, LayoutDashboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { usePageMeta } from '@/hooks/usePageMeta';

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useTranslation(['dashboard', 'common']);

  usePageMeta({
    title: t('common:seo.dashboardTitle'),
    description: t('common:seo.dashboardDescription'),
    canonicalPath: location.pathname.startsWith('/dashboard') ? location.pathname : '/dashboard',
  });

  const tabs = [
    { to: '/dashboard', label: t('nav.overview'), end: true },
    { to: '/dashboard/journals', label: t('nav.journals') },
    { to: '/dashboard/timeline', label: t('nav.timeline') },
    { to: '/dashboard/authors', label: t('nav.authors') },
    { to: '/dashboard/merkle', label: t('nav.merkle') },
  ];

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          title={t('backToLibrary')}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <LayoutDashboard className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t('title')}</span>

        <nav className="ml-2 hidden items-center gap-1 rounded-lg bg-muted p-1 sm:flex">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'inline-flex items-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-background text-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <LanguageSwitcher />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            title={resolvedTheme === 'dark' ? t('common:themeToLight') : t('common:themeToDark')}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>

      {/* Below sm: tab row wraps under the header since there isn't room inline */}
      <nav className="flex items-center gap-1 overflow-x-auto border-b bg-muted/40 p-1.5 sm:hidden">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-background text-foreground shadow'
                  : 'text-muted-foreground hover:text-foreground'
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
