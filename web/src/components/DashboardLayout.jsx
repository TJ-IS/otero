import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageMeta } from '@/hooks/usePageMeta';
import { SiteHeader } from '@/components/SiteHeader';

export function DashboardLayout() {
  const location = useLocation();
  const { t } = useTranslation(['dashboard', 'common']);

  usePageMeta({
    title: t('common:seo.dashboardTitle'),
    description: t('common:seo.dashboardDescription'),
    canonicalPath: location.pathname.startsWith('/dashboard') ? location.pathname : '/dashboard',
  });

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
