import { useState, useCallback } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { Sidebar } from '@/components/Sidebar';
import { ItemTable } from '@/components/ItemTable';
import { ItemDetail } from '@/components/ItemDetail';
import { TopBar } from '@/components/TopBar';
import { api } from '@/api/client';
import { ITEM_TYPE_LABELS } from '@/lib/items';

export default function App() {
  const [filter, setFilter] = useState({ type: null, tag: null, collection: null });
  const [selectedKey, setSelectedKey] = useState(null);
  const [itemsVersion, setItemsVersion] = useState(0);
  const [sidebarVersion, setSidebarVersion] = useState(0);

  const refreshItems = useCallback(() => setItemsVersion(v => v + 1), []);
  const refreshSidebar = useCallback(() => setSidebarVersion(v => v + 1), []);

  const onFilterChange = useCallback((next) => {
    setFilter(next);
    setSelectedKey(null);
  }, []);

  const onImported = useCallback((result) => {
    toast.success(`已导入: ${result.parent?.fields?.title || '(未识别)'}`, {
      description: `类型: ${ITEM_TYPE_LABELS[result.parent?.itemType] || result.parent?.itemType || '—'}`,
    });
    refreshItems();
    refreshSidebar();
    if (result.parent?.key) setSelectedKey(result.parent.key);
  }, [refreshItems, refreshSidebar]);

  const onItemDeleted = useCallback(() => {
    setSelectedKey(null);
    refreshItems();
    refreshSidebar();
    toast.success('条目已删除');
  }, [refreshItems, refreshSidebar]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar
        filter={filter}
        onFilterChange={onFilterChange}
        version={sidebarVersion}
        onRefresh={refreshSidebar}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar filter={filter} onImported={onImported} refreshItems={refreshItems} />
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-hidden border-r">
            <ItemTable
              filter={filter}
              version={itemsVersion}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />
          </div>
          <div className="w-[42%] min-w-[420px] max-w-[640px] overflow-hidden">
            {selectedKey ? (
              <ItemDetail
                itemKey={selectedKey}
                onDeleted={onItemDeleted}
                onChanged={refreshItems}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                请在左侧选择一个条目
              </div>
            )}
          </div>
        </div>
      </div>
      <Toaster richColors position="bottom-right" />
    </div>
  );
}
