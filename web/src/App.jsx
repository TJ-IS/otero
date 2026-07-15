import { Navigate, Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { LibraryView } from '@/components/LibraryView';
import { SearchPage } from '@/components/SearchPage';
import { MerkleTreeView } from '@/components/MerkleTreeView';
import { AuthorGraph } from '@/components/AuthorGraph';
import { AuthorPage } from '@/components/AuthorPage';
import { ItemPage } from '@/components/ItemPage';
import { DashboardLayout } from '@/components/DashboardLayout';
import { DashboardOverview } from '@/components/dashboard/DashboardOverview';
import { DashboardJournals } from '@/components/dashboard/DashboardJournals';
import { DashboardTimeline } from '@/components/dashboard/DashboardTimeline';
import { DashboardAuthorStats } from '@/components/dashboard/DashboardAuthorStats';
import { DocsLayout } from '@/components/DocsLayout';
import { OpenApiDocsPage } from '@/components/OpenApiDocsPage';
import { AgentsMdPage } from '@/components/AgentsMdPage';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LibraryView />} />
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
        <Route path="/authors/:id" element={<AuthorPage />} />
        <Route path="/items/:key" element={<ItemPage />} />
      </Routes>
      <Toaster richColors position="bottom-right" />
    </>
  );
}
