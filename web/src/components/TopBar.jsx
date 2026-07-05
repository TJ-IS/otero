import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, RefreshCw, Search } from 'lucide-react';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { ITEM_TYPE_LABELS } from '@/lib/items';

export function TopBar({ filter, onImported, refreshItems }) {
  const fileInput = useRef(null);

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

  const title = filterTitle(filter);

  return (
    <header className="flex h-12 items-center gap-2 border-b bg-background px-4">
      <div className="font-medium">{title}</div>
      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索 (待实现)"
            disabled
            className="h-8 w-40 pl-8"
          />
        </div>
        <Button variant="outline" size="sm" onClick={refreshItems} title="刷新列表">
          <RefreshCw className="size-4" />
        </Button>
        <Button size="sm" onClick={() => fileInput.current?.click()}>
          <Upload className="size-4" />
          导入 PDF
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

function filterTitle(filter) {
  if (!filter) return '全部条目';
  if (filter.type) return ITEM_TYPE_LABELS[filter.type] || filter.type;
  if (filter.tag) return `#${filter.tag}`;
  if (filter.collection) return '集合视图';
  return '全部条目';
}
