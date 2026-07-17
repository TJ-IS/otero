import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { AuthorAnalyticsPanel } from '@/components/dashboard/AuthorAnalyticsPanel';

export function DashboardAuthorStats() {
  const navigate = useNavigate();
  const { t } = useTranslation('dashboard');

  return (
    <div className="pb-8">
      <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => navigate('/dashboard/authors')}
          >
            <ArrowLeft className="size-4" />
            {t('authors.backToGraph')}
          </Button>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="text-sm font-medium">{t('authors.statsTitle')}</span>
        </div>
      </div>
      <AuthorAnalyticsPanel />
    </div>
  );
}
