import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Library, FileText, Tags as TagsIcon, Folder, Trash2, Plus,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { ITEM_TYPES, ITEM_TYPE_LABELS } from '@/lib/items';

export function Sidebar({ filter, onFilterChange, version, onRefresh }) {
  const { data: collections } = useAsync(() => api.listCollections(), [version]);
  const { data: tags } = useAsync(() => api.listTags(), [version]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const isActive = (kind, value) =>
    filter && filter.kind === kind && filter.value === value;

  const select = (kind, value) => {
    if (isActive(kind, value)) onFilterChange({ type: null, tag: null, collection: null });
    else onFilterChange({ type: kind === 'type' ? value : null, tag: kind === 'tag' ? value : null, collection: kind === 'collection' ? value : null, kind, value });
  };

  const onDeleteCollection = async (key, e) => {
    e.stopPropagation();
    if (!confirm('删除该集合？（仅软删除，条目保留）')) return;
    try {
      await api.deleteCollection(key);
      onRefresh();
    } catch (err) { alert(err.message); }
  };

  const onDeleteTag = async (id, name, e) => {
    e.stopPropagation();
    if (!confirm(`永久删除标签 "${name}"？将从所有条目移除。`)) return;
    try {
      await api.deleteTag(id);
      onRefresh();
    } catch (err) { alert(err.message); }
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
    <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/30">
      <div className="flex h-12 items-center gap-2 border-b px-4 font-semibold">
        <Library className="size-5" />
        Otero
      </div>
      <ScrollArea className="flex-1">
        <div className="px-2 py-3">
          <SidebarSection title="我的文库">
            <SidebarItem
              icon={<FileText className="size-4" />}
              label="全部条目"
              active={!filter || (!filter.type && !filter.tag && !filter.collection)}
              onClick={() => onFilterChange({ type: null, tag: null, collection: null })}
            />
            {ITEM_TYPES.map(t => (
              <SidebarItem
                key={t}
                icon={<FileText className="size-4" />}
                label={ITEM_TYPE_LABELS[t] || t}
                active={filter?.type === t}
                onClick={() => select('type', t)}
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
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    title="删除集合"
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                }
              />
            ))}
          </SidebarSection>

          <Separator className="my-3" />

          <SidebarSection title="标签">
            {(tags || []).length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">暂无标签</div>
            )}
            <div className="flex flex-wrap gap-1.5 px-2">
              {(tags || []).map(t => (
                <Badge
                  key={t.id}
                  variant={filter?.tag === t.name ? 'default' : 'secondary'}
                  className="cursor-pointer gap-1"
                  onClick={() => select('tag', t.name)}
                >
                  <TagsIcon className="size-3" />
                  {t.name}
                  <span className="text-muted-foreground">({t.itemCount})</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteTag(t.id, t.name, e); }}
                    className="ml-1 text-muted-foreground hover:text-destructive"
                    title="永久删除标签"
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
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
