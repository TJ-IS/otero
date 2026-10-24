import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { AuthorAnalyticsPanel } from '@/components/dashboard/AuthorAnalyticsPanel';
import { PageHeader } from '@/components/PageHeader';

export function DashboardAuthorStats() {
  const { t } = useTranslation('dashboard');

  return (
    <div>
      <div className="mx-auto max-w-page px-4 pt-8 sm:px-6 lg:px-8">
        <PageHeader
          title={t('authors.statsTitle')}
          actions={
            <Button type="button" variant="outline" size="sm" asChild>
              <Link to="/dashboard/authors">
                <ArrowLeft className="size-4" />
                {t('authors.backToGraph')}
              </Link>
            </Button>
          }
        />
      </div>
      <AuthorAnalyticsPanel />
    </div>
  );
}
