import { useState, useCallback, useRef, useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Sidebar } from '@/components/Sidebar';
import { ItemTable } from '@/components/ItemTable';
import { ItemDetail } from '@/components/ItemDetail';
import { TopBar } from '@/components/TopBar';
import { cn } from '@/lib/utils';
import { ITEM_TYPE_LABELS } from '@/lib/items';
import { ChevronRight } from 'lucide-react';

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 360;

export default function App() {
  const [filter, setFilter] = useState({ type: null, journal: null, collection: null, search: null });
  const [selectedKey, setSelectedKey] = useState(null);
  const [itemsVersion, setItemsVersion] = useState(0);
  const [sidebarVersion, setSidebarVersion] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailDirty, setDetailDirty] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const resizing = useRef(false);
  const sidebarRef = useRef(null);

  const refreshItems = useCallback(() => setItemsVersion(v => v + 1), []);
  const refreshSidebar = useCallback(() => setSidebarVersion(v => v + 1), []);

  const onFilterChange = useCallback((next) => {
    setFilter(prev => ({ ...prev, ...next }));
    setSelectedKey(null);
    setDetailOpen(false);
  }, []);

  const onSearch = useCallback((search) => {
    setFilter(prev => ({ ...prev, search: search || null }));
    setSelectedKey(null);
    setDetailOpen(false);
  }, []);

  const onImported = useCallback((result) => {
    toast.success(`已导入: ${result.parent?.fields?.title || '(未识别)'}`, {
      description: `类型: ${ITEM_TYPE_LABELS[result.parent?.itemType] || result.parent?.itemType || '—'}`,
    });
    refreshItems();
    refreshSidebar();
    if (result.parent?.key) {
      setSelectedKey(result.parent.key);
      setDetailOpen(true);
    }
  }, [refreshItems, refreshSidebar]);

  const onItemDeleted = useCallback(() => {
    setSelectedKey(null);
    setDetailDirty(false);
    setDetailOpen(false);
    refreshItems();
    refreshSidebar();
    toast.success('条目已删除');
  }, [refreshItems, refreshSidebar]);

  const onSelect = useCallback((key) => {
    setSelectedKey(key);
    setDetailOpen(true);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(v => !v);
  }, []);

  // Sidebar drag resize
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!resizing.current) return;
      const w = Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, e.clientX));
      setSidebarWidth(w);
    };
    const handleMouseUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.pointerEvents = '';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const startResize = useCallback((e) => {
    e.preventDefault();
    resizing.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.style.pointerEvents = 'none';
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Left sidebar */}
      <div
        ref={sidebarRef}
        className={cn(
          'shrink-0 border-r bg-muted/30 overflow-hidden',
          isResizing ? 'transition-none' : 'transition-all duration-200',
        )}
        style={{ width: sidebarOpen ? Math.max(MIN_SIDEBAR, sidebarWidth) : 0 }}
      >
        <div className="flex h-full w-full" style={{ minWidth: MIN_SIDEBAR }}>
          <Sidebar
            filter={filter}
            onFilterChange={onFilterChange}
            version={sidebarVersion}
            onRefresh={refreshSidebar}
            onCollapse={toggleSidebar}
          />
        </div>
      </div>

      {/* Sidebar resize handle (only visible when sidebar is open) */}
      {sidebarOpen && (
        <div
          onMouseDown={startResize}
          className="w-1 shrink-0 bg-border cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
        />
      )}

      {/* Collapsed sidebar expand button */}
      {!sidebarOpen && (
        <button
          onClick={toggleSidebar}
          className="flex shrink-0 items-center border-r bg-muted/30 px-1 text-muted-foreground hover:text-foreground transition-colors"
          title="展开侧栏"
        >
          <ChevronRight className="size-3.5" />
        </button>
      )}

      {/* Main content */}
      <main className="flex flex-1 flex-col min-w-[320px]">
        <TopBar filter={filter} onImported={onImported} refreshItems={refreshItems} onSearch={onSearch} sidebarVersion={sidebarVersion} />
        <div className="flex-1 overflow-hidden">
          <ItemTable
            filter={filter}
            version={itemsVersion}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        </div>
      </main>

      {/* Right detail sheet */}
      <Sheet
        open={detailOpen}
        onOpenChange={(open) => {
          if (!open && detailDirty) {
            setConfirmCloseOpen(true);
            return;
          }
          setDetailOpen(open);
          if (!open) setSelectedKey(null);
        }}
      >
        <SheetContent className="p-0">
          <SheetTitle className="sr-only">条目详情</SheetTitle>
          {selectedKey ? (
            <ItemDetail
              itemKey={selectedKey}
              onDeleted={onItemDeleted}
              onChanged={refreshItems}
              onDirtyChange={setDetailDirty}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              请在左侧选择一个条目
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>
              当前条目有未保存的修改，关闭后将丢失这些改动。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDetailDirty(false);
                setDetailOpen(false);
                setSelectedKey(null);
              }}
            >
              放弃并关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster richColors position="bottom-right" />
    </div>
  );
}
