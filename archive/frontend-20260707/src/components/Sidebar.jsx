import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Library, FileText, BookOpen, Folder, Trash2, Plus, ChevronLeft,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';


export function Sidebar({ filter, onFilterChange, version, onRefresh, onCollapse }) {
  const { data: collections } = useAsync(() => api.listCollections(), [version]);
  const { data: journals } = useAsync(() => api.listJournals(), [version]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const isActive = (kind, value) => {
    if (kind === 'journal') return filter?.journal === value;
    if (kind === 'collection') return filter?.collection === value;
    return false;
  };

  const select = (kind, value) => {
    if (isActive(kind, value)) {
      onFilterChange({ type: null, journal: null, collection: null });
    } else {
      onFilterChange({
        type: null,
        journal: kind === 'journal' ? value : null,
        collection: kind === 'collection' ? value : null,
      });
    }
  };

  const onDeleteCollection = async (key, e) => {
    e.stopPropagation();
    if (!confirm('删除该集合？（仅软删除，条目保留）')) return;
    try {
      await api.deleteCollection(key);
      onRefresh();
    } catch (err) {
      toast.error(`删除失败: ${err.message}`);
    }
  };

  const createCollection = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.createCollection({ name });
      setNewName('');
      setCreateOpen(false);
      onRefresh();
      toast.success('集合已创建');
    } catch (err) {
      toast.error(`创建失败: ${err.message}`);
    }
  };

  return (
    <aside className="flex w-full shrink-0 flex-col bg-muted/30">
      <div className="flex h-12 items-center gap-2 border-b px-4 font-semibold">
        <Library className="size-5" />
        <span className="flex-1">Otero</span>
        <button onClick={onCollapse} className="text-muted-foreground hover:text-foreground transition-colors" title="折叠侧栏">
          <ChevronLeft className="size-3.5" />
        </button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 py-3">
          <SidebarSection title="我的文库">
            <SidebarItem
              icon={<FileText className="size-4" />}
              label="全部条目"
              active={!filter || (!filter.journal && !filter.collection)}
              onClick={() => onFilterChange({ type: null, journal: null, collection: null })}
            />
          </SidebarSection>

          <Separator className="my-3" />

          <SidebarSection title="期刊分类">
            {(journals || []).length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">暂无期刊</div>
            )}
            {(journals || []).map(j => (
              <SidebarItem
                key={j.name}
                icon={<BookOpen className="size-4" />}
                label={`${j.name} (${j.itemCount})`}
                active={filter?.journal === j.name}
                onClick={() => select('journal', j.name)}
              />
            ))}
          </SidebarSection>

          <Separator className="my-3" />

          <SidebarSection
            title="集合"
            action={
              <button
                onClick={() => setCreateOpen(true)}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="新建集合"
              >
                <Plus className="size-3.5" />
              </button>
            }
          >
            {(collections || []).length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">暂无集合</div>
            )}
            {(collections || []).map(c => (
              <SidebarItem
                key={c.key}
                icon={<Folder className="size-4" />}
                label={c.name}
                active={filter?.collection === c.key}
                onClick={() => select('collection', c.key)}
                trailing={
                  <button
                    onClick={(e) => onDeleteCollection(c.key, e)}
                    className="rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:bg-accent hover:text-destructive hover:opacity-100"
                    title="删除集合"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                }
              />
            ))}
          </SidebarSection>
        </div>
      </ScrollArea>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建集合</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="col-name" className="block">名称</Label>
            <Input
              id="col-name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="如：机器学习"
              onKeyDown={e => e.key === 'Enter' && createCollection()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={createCollection}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function SidebarSection({ title, children, action }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
        {action}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick, trailing }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {trailing}
    </button>
  );
}
