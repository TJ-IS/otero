import { Link, NavLink, Outlet } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export function DocsLayout() {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useTranslation(['docs', 'common']);

  const tabs = [
    { to: '/docs/api', label: t('nav.api') },
    { to: '/docs/agents', label: t('nav.agents') },
  ];

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
        <Button variant="ghost" size="sm" asChild className="shrink-0 text-muted-foreground">
          <Link to="/" title={t('common:backToLibrary')}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-sm font-medium tracking-tight">{t('title')}</h1>

        <nav className="ml-2 flex items-center gap-1 rounded-lg bg-muted p-1">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  'inline-flex items-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-background text-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <LanguageSwitcher />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            title={t('toggleTheme')}
          >
            {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>

      <Outlet />
    </div>
  );
}
