import { Menu, Moon, Sun } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { WalletButton } from '@/components/WalletButton';
import { useTheme } from 'next-themes';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PRIMARY_NAV, isNavActive } from '@/lib/nav-sections';

/**
 * The only chrome above page content. Sections expose their sub-pages through
 * the dropdowns here, so pages must never render a second navigation row.
 */
export function SiteHeader({ className, actions }) {
  const { t } = useTranslation(['common', 'dashboard', 'docs', 'admin']);
  const { resolvedTheme, setTheme } = useTheme();
  const { canEdit } = useAuth();
  const { pathname } = useLocation();

  const items = PRIMARY_NAV.filter((item) => !item.editorsOnly || canEdit);

  return (
    <header className={cn('site-header sticky top-0 z-40 border-b border-border/90 bg-background/95 backdrop-blur', className)}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {t('skipToContent')}
      </a>
      <div className="mx-auto flex h-14 w-full max-w-page items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="flex shrink-0 items-center text-foreground transition-colors hover:text-brand"
          aria-label={t('brandHome')}
        >
          <span className="font-display text-xl font-semibold">Otero</span>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="md:hidden" aria-label={t('primaryNavigation')}>
              <Menu className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {items.map((item) => {
              const Icon = item.icon;
              if (item.children) {
                return (
                  <div key={item.key}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="flex items-center gap-2 text-muted-foreground">
                      <Icon className="size-3.5" strokeWidth={1.8} />
                      {t(`nav.${item.key}`)}
                    </DropdownMenuLabel>
                    {item.children.map((child) => {
                      const ChildIcon = child.icon;
                      const childActive = isNavActive(child, pathname);
                      return (
                        <DropdownMenuItem key={child.to} asChild>
                          <NavLink
                            to={child.to}
                            end={child.end}
                            className={cn(
                              'gap-2.5 pl-7 text-muted-foreground',
                              childActive && 'font-medium text-foreground',
                            )}
                          >
                            {ChildIcon ? (
                              <ChildIcon
                                className={cn('size-3.5 shrink-0', childActive ? 'text-brand' : 'text-muted-foreground/70')}
                                strokeWidth={1.8}
                              />
                            ) : null}
                            {t(`${item.childrenNs}:${child.labelKey}`)}
                          </NavLink>
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                );
              }
              return (
                <DropdownMenuItem key={item.key} asChild>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={cn('gap-2.5', isNavActive(item, pathname) && 'font-medium text-brand')}
                  >
                    <Icon className="size-3.5" strokeWidth={1.8} />
                    {t(`nav.${item.key}`)}
                  </NavLink>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <NavigationMenu
          viewport={false}
          className="hidden min-w-0 justify-start md:flex"
          aria-label={t('primaryNavigation')}
        >
          <NavigationMenuList className="justify-start">
            {items.map((item) => {
              const Icon = item.icon;
              const active = isNavActive(item, pathname);
              if (item.children) {
                return (
                  <NavigationMenuItem key={item.key}>
                    <NavigationMenuTrigger className={cn(active && 'border-brand text-brand')}>
                      <Icon className="size-3.5" strokeWidth={1.8} />
                      <span>{t(`nav.${item.key}`)}</span>
                    </NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <ul className="grid min-w-[11rem] gap-px p-1">
                        {item.children.map((child) => {
                          const ChildIcon = child.icon;
                          const childActive = isNavActive(child, pathname);
                          return (
                            <li key={child.to}>
                              <NavigationMenuLink asChild>
                                <NavLink
                                  to={child.to}
                                  end={child.end}
                                  className={cn(
                                    'group/link relative flex items-center gap-2.5 rounded-sm py-1.5 pl-3 pr-6 text-[13px] leading-5 text-muted-foreground transition-colors',
                                    'before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-brand before:opacity-0 before:transition-opacity',
                                    'hover:bg-accent/60 hover:text-foreground',
                                    childActive && 'font-medium text-foreground before:opacity-100',
                                  )}
                                >
                                  {ChildIcon ? (
                                    <ChildIcon
                                      className={cn(
                                        'size-3.5 shrink-0 transition-colors group-hover/link:text-brand',
                                        childActive ? 'text-brand' : 'text-muted-foreground/70',
                                      )}
                                      strokeWidth={1.8}
                                    />
                                  ) : null}
                                  <span className="whitespace-nowrap">
                                    {t(`${item.childrenNs}:${child.labelKey}`)}
                                  </span>
                                </NavLink>
                              </NavigationMenuLink>
                            </li>
                          );
                        })}
                      </ul>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                );
              }

              return (
                <NavigationMenuItem key={item.key}>
                  <NavigationMenuLink asChild>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={cn(navigationMenuTriggerStyle(), active && 'border-brand text-brand')}
                    >
                      <Icon className="size-3.5" strokeWidth={1.8} />
                      <span>{t(`nav.${item.key}`)}</span>
                    </NavLink>
                  </NavigationMenuLink>
                </NavigationMenuItem>
              );
            })}
          </NavigationMenuList>
        </NavigationMenu>

        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          {actions ? (
            <>
              <div className="flex items-center gap-1.5">{actions}</div>
              <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            </>
          ) : null}
          <LanguageSwitcher />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            title={resolvedTheme === 'dark' ? t('themeToLight') : t('themeToDark')}
            className="text-muted-foreground hover:text-brand"
          >
            {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            <span className="sr-only">{t('toggleTheme')}</span>
          </Button>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
