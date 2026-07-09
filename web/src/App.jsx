import { Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { LibraryView } from '@/components/LibraryView';
import { SearchPage } from '@/components/SearchPage';
import { MerkleTreeView } from '@/components/MerkleTreeView';
import { ItemPage } from '@/components/ItemPage';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LibraryView />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/merkle" element={<MerkleTreeView />} />
        <Route path="/items/:key" element={<ItemPage />} />
      </Routes>
      <Toaster richColors position="bottom-right" />
    </>
  );
}
