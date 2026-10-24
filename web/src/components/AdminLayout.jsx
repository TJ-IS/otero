import { Link, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePageMeta } from '@/hooks/usePageMeta';
import { SiteHeader } from '@/components/SiteHeader';

export function AdminLayout() {
  const { canEdit } = useAuth();
  const { t } = useTranslation(['admin', 'common']);

  usePageMeta({
    title: t('common:seo.adminTitle'),
    description: t('common:seo.adminDescription'),
    canonicalPath: '/admin',
    robots: 'noindex, nofollow',
  });

  if (!canEdit) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <SiteHeader />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground"
        >
          <ShieldCheck className="size-10 text-brand/60" />
          <p className="text-sm">{t('forbidden')}</p>
          <Button variant="outline" size="sm" asChild>
            <Link to="/library">{t('backToLibrary')}</Link>
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
