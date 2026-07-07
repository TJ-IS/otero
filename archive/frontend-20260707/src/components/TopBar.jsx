import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, RefreshCw, Search } from 'lucide-react';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { ITEM_TYPE_LABELS } from '@/lib/items';
import { useAsync } from '@/hooks/useAsync';

export function TopBar({ filter, onImported, refreshItems, onSearch, sidebarVersion = 0 }) {
  const fileInput = useRef(null);
  const searchRef = useRef(null);
  const [searchValue, setSearchValue] = useState('');
  const { data: collections } = useAsync(() => api.listCollections(), [sidebarVersion]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchValue !== (filter?.search || '')) {
        onSearch(searchValue);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue]);

  // Clear search when filter changes
  useEffect(() => {
    if (filter?.journal || filter?.collection) {
      setSearchValue('');
    }
  }, [filter?.journal, filter?.collection]);

  useEffect(() => {
    if (filter?.search === null && searchValue) {
      setSearchValue('');
    }
  }, [filter?.search]);

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = '';
    for (const file of files) {
      const tid = toast.loading(`正在导入 ${file.name}...`);
      try {
        const result = await api.uploadPdf(file);
        toast.success(`已导入: ${result.parent?.fields?.title || '(未识别)'}`, {
          id: tid,
          description: `类型: ${ITEM_TYPE_LABELS[result.parent?.itemType] || result.parent?.itemType || '—'}`,
        });
        onImported(result);
      } catch (err) {
        toast.error(`导入失败: ${err.message}`, { id: tid });
      }
    }
  };

  const title = filterTitle(filter, collections);

  return (
    <header className="flex min-h-12 flex-wrap items-center gap-2 border-b bg-background px-4 py-1.5">
      <div className="font-medium truncate max-w-[200px] sm:max-w-[280px]" title={title}>{title}</div>
      <div className="ml-auto flex flex-1 items-center justify-end gap-2 min-w-0">
        <div className="relative flex-1 max-w-xs min-w-[140px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="搜索标题、作者、DOI..."
            value={searchValue}
            onChange={e => setSearchValue(e.target.value)}
            className="h-8 w-full pl-8"
          />
        </div>
        <Button variant="outline" size="sm" onClick={refreshItems} title="刷新列表">
          <RefreshCw className="size-4" />
        </Button>
        <Button size="sm" onClick={() => fileInput.current?.click()}>
          <Upload className="size-4" />
          <span className="hidden sm:inline">导入 PDF</span>
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={handleFiles}
        />
      </div>
    </header>
  );
}

function filterTitle(filter, collections) {
  if (!filter) return '全部条目';
  if (filter.search) return `搜索: "${filter.search}"`;
  if (filter.journal) return filter.journal;
  if (filter.collection) {
    const c = collections?.find(c => c.key === filter.collection);
    return c?.name || '集合视图';
  }
  return '全部条目';
}
