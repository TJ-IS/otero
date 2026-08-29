import { lazy, Suspense, useEffect } from 'react';
import { Link, Navigate, Routes, Route } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Toaster } from '@/components/ui/sonner';
import { usePageMeta } from '@/hooks/usePageMeta';
import { ResearchPortal } from '@/components/ResearchPortal';

function lazyNamed(loader, name) {
  return lazy(() => loader().then(module => ({ default: module[name] })));
}

const LibraryView = lazyNamed(() => import('@/components/LibraryView'), 'LibraryView');
const JournalsPage = lazyNamed(() => import('@/components/JournalsPage'), 'JournalsPage');
const SearchPage = lazyNamed(() => import('@/components/SearchPage'), 'SearchPage');
const MerkleTreeView = lazyNamed(() => import('@/components/MerkleTreeView'), 'MerkleTreeView');
const AuthorGraph = lazyNamed(() => import('@/components/AuthorGraph'), 'AuthorGraph');
const AuthorPage = lazyNamed(() => import('@/components/AuthorPage'), 'AuthorPage');
const ItemPage = lazyNamed(() => import('@/components/ItemPage'), 'ItemPage');
const DashboardLayout = lazyNamed(() => import('@/components/DashboardLayout'), 'DashboardLayout');
const DashboardOverview = lazyNamed(() => import('@/components/dashboard/DashboardOverview'), 'DashboardOverview');
const DashboardJournals = lazyNamed(() => import('@/components/dashboard/DashboardJournals'), 'DashboardJournals');
const DashboardTimeline = lazyNamed(() => import('@/components/dashboard/DashboardTimeline'), 'DashboardTimeline');
const DashboardAuthorStats = lazyNamed(() => import('@/components/dashboard/DashboardAuthorStats'), 'DashboardAuthorStats');
const DocsLayout = lazyNamed(() => import('@/components/DocsLayout'), 'DocsLayout');
const OpenApiDocsPage = lazyNamed(() => import('@/components/OpenApiDocsPage'), 'OpenApiDocsPage');
const AgentsMdPage = lazyNamed(() => import('@/components/AgentsMdPage'), 'AgentsMdPage');
const AdminLayout = lazyNamed(() => import('@/components/AdminLayout'), 'AdminLayout');
const SystemStatusPanel = lazyNamed(() => import('@/components/admin/SystemStatusPanel'), 'SystemStatusPanel');
const DuplicatesPanel = lazyNamed(() => import('@/components/admin/DuplicatesPanel'), 'DuplicatesPanel');
const StorageReconciliationPanel = lazyNamed(
  () => import('@/components/admin/StorageReconciliationPanel'),
  'StorageReconciliationPanel'
);
const TrashPanel = lazyNamed(() => import('@/components/admin/TrashPanel'), 'TrashPanel');

function RouteFallback() {
  const { t } = useTranslation('common');
  return (
    <div className="min-h-[100dvh] bg-background p-6" aria-busy="true" aria-label={t('loadingPage')}>
      <div className="mx-auto max-w-5xl animate-pulse space-y-5">
        <div className="h-8 w-48 rounded-sm bg-muted" />
        <div className="h-4 w-72 max-w-full rounded-sm bg-muted" />
        <div className="h-56 rounded-sm bg-muted/70" />
      </div>
    </div>
  );
}

function NotFoundPage() {
  const { t } = useTranslation('common');
  usePageMeta({
    title: `${t('notFound.title')} | Otero`,
    description: t('notFound.body'),
    robots: 'noindex, follow',
  });
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <FileQuestion className="size-9 text-muted-foreground" />
      <h1 className="font-display text-2xl font-semibold">{t('notFound.title')}</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{t('notFound.body')}</p>
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm font-medium text-brand hover:underline">{t('brandHome')}</Link>
        <Link to="/library" className="rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{t('backToLibrary')}</Link>
      </div>
    </main>
  );
}

/** Fades out the pre-boot placeholder in index.html once React has painted. */
function useHideBootSkeleton() {
  useEffect(() => {
    const el = document.getElementById('app-skeleton');
    if (!el) return undefined;
    el.style.opacity = '0';
    const timer = setTimeout(() => el.remove(), 220);
    return () => clearTimeout(timer);
  }, []);
}

export default function App() {
  useHideBootSkeleton();

  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<ResearchPortal />} />
          <Route path="/library" element={<LibraryView />} />
          <Route path="/journals" element={<JournalsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/docs" element={<DocsLayout />}>
            <Route index element={<Navigate to="api" replace />} />
            <Route path="api" element={<OpenApiDocsPage />} />
            <Route path="agents" element={<AgentsMdPage />} />
          </Route>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<DashboardOverview />} />
            <Route path="journals" element={<DashboardJournals />} />
            <Route path="timeline" element={<DashboardTimeline />} />
            <Route path="authors" element={<AuthorGraph />} />
            <Route path="authors/stats" element={<DashboardAuthorStats />} />
            <Route path="merkle" element={<MerkleTreeView />} />
          </Route>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<SystemStatusPanel />} />
            <Route path="duplicates" element={<DuplicatesPanel />} />
            <Route path="reconcile" element={<StorageReconciliationPanel />} />
            <Route path="trash" element={<TrashPanel />} />
          </Route>
          <Route path="/authors/:id" element={<AuthorPage />} />
          <Route path="/items/:key" element={<ItemPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      <Toaster richColors position="bottom-right" />
    </>
  );
}
