import { Outlet } from 'react-router-dom';
import { SiteHeader } from '@/components/SiteHeader';

export function DocsLayout() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" tabIndex={-1}><Outlet /></main>
    </div>
  );
}
