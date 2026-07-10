import { memo, useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from './ui/dialog';
import { Checkbox } from './ui/checkbox';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import {
  Globe, Loader2, CheckCircle2, AlertCircle, Users,
} from 'lucide-react';

const STATUS_META = {
  match:    { label: '一致', variant: 'secondary' },
  missing:  { label: '可填充', variant: 'outline', cls: 'text-amber-600 dark:text-amber-500' },
  conflict: { label: '不符', variant: 'destructive' },
};

const FIELD_LABELS = {
  title: '标题', abstractNote: '摘要', publicationTitle: '期刊',
  volume: '卷', issue: '期', pages: '页码',
  date: '日期', DOI: 'DOI', ISSN: 'ISSN', url: 'URL',
  language: '语言', publisher: '出版社',
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.match;
  return (
    <Badge variant={m.variant} className={`font-normal ${m.cls || ''}`}>
      {m.label}
    </Badge>
  );
}

function fieldLabel(name) {
  return FIELD_LABELS[name] || name;
}

function FieldRow({ field, checked, onToggle }) {
  const changeable = field.status === 'missing' || field.status === 'conflict';
  return (
    <label
      className={`flex items-start gap-3 py-2.5 transition-colors ${
        changeable ? 'hover:bg-accent/40 -mx-2 px-2 rounded-sm' : 'opacity-60'
      }`}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        disabled={!changeable}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{fieldLabel(field.field)}</span>
          <StatusBadge status={field.status} />
        </div>
        <div className="mt-1 space-y-0.5 text-xs">
          <div className="text-muted-foreground">
            <span className="text-muted-foreground/80">当前：</span>
            <span className="break-all">{field.current || <em>（空）</em>}</span>
          </div>
          {changeable && (
            <div className="text-foreground">
              <span className="text-muted-foreground/80">CrossRef：</span>
              <span className="break-all font-medium">{field.suggested}</span>
            </div>
          )}
        </div>
      </div>
    </label>
  );
}

export const CrossrefPanel = memo(function CrossrefPanel({
  open, onOpenChange, result, loading, error, onApply,
}) {
  const [fieldSel, setFieldSel] = useState({});
  const [applyCreators, setApplyCreators] = useState(false);
  const [applyItemType, setApplyItemType] = useState(false);

  useEffect(() => {
    if (!result) {
      setFieldSel({});
      setApplyCreators(false);
      setApplyItemType(false);
      return;
    }
    const fs = {};
    (result.fields || []).forEach(f => {
      // Auto-select fillable empties; leave conflicts for the admin to decide.
      fs[f.field] = f.status === 'missing';
    });
    setFieldSel(fs);
    setApplyCreators(result.creators?.status === 'missing');
    setApplyItemType(
      Boolean(result.suggestedItemType)
      && result.suggestedItemType !== result.itemType
    );
  }, [result]);

  const changeableFields = useMemo(
    () => (result?.fields || []).filter(f => f.status === 'missing' || f.status === 'conflict'),
    [result],
  );
  const conflictFields = useMemo(
    () => (result?.fields || []).filter(f => f.status === 'conflict'),
    [result],
  );
  const missingFields = useMemo(
    () => (result?.fields || []).filter(f => f.status === 'missing'),
    [result],
  );

  const selectedFieldCount = Object.values(fieldSel).filter(Boolean).length;
  const totalSelected = selectedFieldCount
    + (applyCreators ? 1 : 0)
    + (applyItemType ? 1 : 0);

  const selectFillable = () => {
    const fs = {};
    missingFields.forEach(f => { fs[f.field] = true; });
    setFieldSel(fs);
    setApplyCreators(result?.creators?.status === 'missing');
  };
  const selectConflicts = () => {
    const fs = { ...fieldSel };
    conflictFields.forEach(f => { fs[f.field] = true; });
    setFieldSel(fs);
    if (result?.creators?.status === 'conflict') setApplyCreators(true);
  };
  const selectNone = () => {
    setFieldSel({});
    setApplyCreators(false);
    setApplyItemType(false);
  };

  const handleApply = () => {
    if (totalSelected === 0) {
      toast.info('未选择任何修改');
      return;
    }
    const acceptedFields = {};
    (result?.fields || []).forEach(f => {
      if (fieldSel[f.field]) acceptedFields[f.field] = f.suggested ?? '';
    });
    const acceptedCreators = applyCreators
      ? (result?.creators?.suggested || []).map((c, i) => ({
          firstName: c.firstName || '',
          lastName: c.lastName || '',
          creatorType: c.creatorType || 'author',
          fieldMode: c.fieldMode || 0,
          orderIndex: i,
        }))
      : null;
    onApply({
      fields: acceptedFields,
      creators: acceptedCreators,
      itemType: applyItemType ? result.suggestedItemType : null,
    });
  };

  const creatorsChangeable = result?.creators
    && (result.creators.status === 'missing' || result.creators.status === 'conflict');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-5" /> CrossRef 解析
          </DialogTitle>
          <DialogDescription>
            {result ? (
              <>
                DOI <span className="font-mono text-foreground">{result.doi}</span>
                {' · '}
                <span className="text-amber-600 dark:text-amber-500">{result.summary?.missing || 0}</span> 可填充
                {' · '}
                <span className="text-destructive">{result.summary?.conflict || 0}</span> 不符
                {' · '}
                <span className="text-muted-foreground">{result.summary?.match || 0}</span> 一致
              </>
            ) : (
              '根据 DOI 从 CrossRef 拉取元数据，勾选后写入草稿，再点「保存」生效。'
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            正在查询 CrossRef…
          </div>
        ) : error ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-center px-6">
            <AlertCircle className="size-5 text-destructive" />
            <span className="text-sm text-destructive">{error}</span>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>关闭</Button>
          </div>
        ) : result ? (
          <>
            <div className="flex items-center justify-between px-6 py-2 border-b">
              <div className="text-xs text-muted-foreground">
                {changeableFields.length === 0 && !creatorsChangeable
                  ? '全部字段与 CrossRef 一致'
                  : `请核对不符项后再应用`}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={selectFillable}>
                  全选可填充
                </Button>
                {conflictFields.length > 0 && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={selectConflicts}>
                    含不符项
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={selectNone}>
                  清空
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-3">
              {result.suggestedItemType && result.suggestedItemType !== result.itemType && (
                <label className="flex items-start gap-3 py-2.5 mb-2 hover:bg-accent/40 -mx-2 px-2 rounded-sm">
                  <Checkbox
                    checked={applyItemType}
                    onCheckedChange={v => setApplyItemType(!!v)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">类型</span>
                      <StatusBadge status="conflict" />
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      当前：{result.itemType}
                      <span className="mx-1.5">→</span>
                      <span className="font-medium text-foreground">{result.suggestedItemType}</span>
                    </div>
                  </div>
                </label>
              )}

              <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">字段</h3>
              <div className="divide-y">
                {(result.fields || []).map(f => (
                  <FieldRow
                    key={f.field}
                    field={f}
                    checked={!!fieldSel[f.field]}
                    onToggle={v => setFieldSel(s => ({ ...s, [f.field]: !!v }))}
                  />
                ))}
              </div>

              {result.creators && (
                <>
                  <h3 className="mb-1 mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Users className="size-3.5" /> 作者
                  </h3>
                  <label
                    className={`flex items-start gap-3 py-2.5 ${
                      creatorsChangeable ? 'hover:bg-accent/40 -mx-2 px-2 rounded-sm' : 'opacity-60'
                    }`}
                  >
                    <Checkbox
                      checked={applyCreators}
                      onCheckedChange={v => setApplyCreators(!!v)}
                      disabled={!creatorsChangeable}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1 text-xs space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">作者列表</span>
                        <StatusBadge status={result.creators.status} />
                      </div>
                      <div className="text-muted-foreground">
                        <span className="text-muted-foreground/80">当前：</span>
                        {result.creators.current?.length
                          ? result.creators.current.map(c => c.label).join('; ')
                          : <em>（空）</em>}
                      </div>
                      {creatorsChangeable && (
                        <div className="text-foreground">
                          <span className="text-muted-foreground/80">CrossRef：</span>
                          <span className="font-medium">
                            {result.creators.suggested.map(c => c.label).join('; ')}
                          </span>
                        </div>
                      )}
                      {applyCreators && (
                        <p className="text-amber-600 dark:text-amber-500">
                          应用后将用 CrossRef 作者列表整体替换当前作者
                        </p>
                      )}
                    </div>
                  </label>
                </>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-3 border-t">
              <span className="text-xs text-muted-foreground">
                应用后写入草稿，需在详情页点「保存」才生效
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
                <Button size="sm" onClick={handleApply} disabled={totalSelected === 0}>
                  <CheckCircle2 className="size-3.5" />
                  应用到草稿（{totalSelected}）
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">无结果</div>
        )}
      </DialogContent>
    </Dialog>
  );
});
