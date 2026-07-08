import { memo, useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from './ui/dialog';
import { Checkbox } from './ui/checkbox';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import {
  Wand2, Loader2, CheckCircle2, AlertCircle,
  ChevronRight, ChevronDown, Copy, Check,
} from 'lucide-react';

// Status → shadcn Badge variant + optional muted tint. Matches the app's
// neutral-palette convention (see MineruTaskLog.StateBadge): neutral/secondary
// for non-actionable, destructive for errors, outline + subtle color for
// warnings. No saturated background pills.
const STATUS_META = {
  correct:   { label: '正确', variant: 'secondary' },
  incorrect: { label: '有误', variant: 'destructive' },
  missing:   { label: '缺失', variant: 'outline', cls: 'text-amber-600 dark:text-amber-500' },
  extra:     { label: '多余', variant: 'outline', cls: 'text-muted-foreground' },
};

// Overall accuracy rendered as inline colored text in the header description,
// mirroring MineruTaskLog's `text-green-600` / `text-red-600` count style.
const ACCURACY_TEXT = {
  high:    { label: '高',   cls: 'text-green-600 dark:text-green-500' },
  medium:  { label: '中',   cls: 'text-amber-600 dark:text-amber-500' },
  low:     { label: '低',   cls: 'text-red-600 dark:text-red-500' },
  unknown: { label: '未知', cls: 'text-muted-foreground' },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.correct;
  return (
    <Badge variant={m.variant} className={`font-normal ${m.cls || ''}`}>
      {m.label}
    </Badge>
  );
}

function confidencePct(c) {
  const n = typeof c === 'number' ? c : parseFloat(c);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

// Collapsible LLM I/O block with a copy button. Used for tracing what was
// actually sent to / received from the model.
function DebugBlock({ label, content, copied, onCopy }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={() => onCopy(content)}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
      <pre className="max-h-[60vh] overflow-auto rounded-md border bg-background p-3 text-xs leading-relaxed whitespace-pre-wrap break-all font-mono">
        {content || '（空）'}
      </pre>
    </div>
  );
}

function FieldRow({ field, checked, onToggle }) {
  const changed = field.suggested !== field.current && field.status !== 'correct';
  const pct = confidencePct(field.confidence);
  const isCorrect = field.status === 'correct';

  return (
    <label
      className={`flex items-start gap-3 py-2.5 transition-colors ${
        isCorrect ? 'opacity-60' : 'hover:bg-accent/40 -mx-2 px-2 rounded-sm'
      }`}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        disabled={isCorrect || !changed}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{field.field}</span>
          <StatusBadge status={field.status} />
          {pct != null && (
            <span className="text-xs text-muted-foreground tabular-nums">置信度 {pct}%</span>
          )}
        </div>
        <div className="mt-1 space-y-0.5 text-xs">
          <div className="text-muted-foreground">
            <span className="text-muted-foreground/80">当前：</span>
            <span className="break-all">{field.current || <em>（空）</em>}</span>
          </div>
          {changed && (
            <div className="text-foreground">
              <span className="text-muted-foreground/80">建议：</span>
              <span className="break-all font-medium">{field.suggested || <em className="text-muted-foreground">（清空）</em>}</span>
            </div>
          )}
          {field.reason && (
            <div className="text-muted-foreground italic">{field.reason}</div>
          )}
        </div>
      </div>
    </label>
  );
}

function CreatorRow({ creator, checked, onToggle }) {
  const cur = creator.current || {};
  const sug = creator.suggested || {};
  const curName = [cur.lastName, cur.firstName].filter(Boolean).join(', ') || '（空）';
  const sugName = [sug.lastName, sug.firstName].filter(Boolean).join(', ') || '（空）';
  const changed = curName !== sugName && creator.status !== 'correct';
  const pct = confidencePct(creator.confidence);
  const isCorrect = creator.status === 'correct';

  return (
    <label
      className={`flex items-start gap-3 py-2.5 transition-colors ${
        isCorrect ? 'opacity-60' : 'hover:bg-accent/40 -mx-2 px-2 rounded-sm'
      }`}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        disabled={isCorrect || !changed}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            作者 #{(creator.index ?? 0) + 1}
            <span className="text-muted-foreground font-normal"> · {cur.creatorType || 'author'}</span>
          </span>
          <StatusBadge status={creator.status} />
          {pct != null && (
            <span className="text-xs text-muted-foreground tabular-nums">置信度 {pct}%</span>
          )}
        </div>
        <div className="mt-1 space-y-0.5 text-xs">
          <div className="text-muted-foreground">
            <span className="text-muted-foreground/80">当前：</span>{curName}
          </div>
          {changed && (
            <div className="text-foreground">
              <span className="text-muted-foreground/80">建议：</span>
              <span className="font-medium">{sugName}</span>
            </div>
          )}
          {creator.reason && <div className="text-muted-foreground italic">{creator.reason}</div>}
        </div>
      </div>
    </label>
  );
}

export const CalibratePanel = memo(function CalibratePanel({
  open, onOpenChange, result, loading, error, onApply,
}) {
  const [fieldSel, setFieldSel] = useState({});
  const [creatorSel, setCreatorSel] = useState({});
  const [debugOpen, setDebugOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);

  const copyDebug = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopiedKey(key);
      toast.success('已复制');
      setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 1500);
    } catch {
      toast.error('复制失败');
    }
  };

  // Reset selection whenever a new result arrives.
  useEffect(() => {
    if (!result) { setFieldSel({}); setCreatorSel({}); return; }
    const fs = {};
    (result.fields || []).forEach(f => {
      const changed = f.suggested !== f.current && f.status !== 'correct';
      fs[f.field] = changed;
    });
    const cs = {};
    (result.creators || []).forEach(c => {
      const cur = c.current || {};
      const sug = c.suggested || {};
      const curName = [cur.lastName, cur.firstName].filter(Boolean).join(', ');
      const sugName = [sug.lastName, sug.firstName].filter(Boolean).join(', ');
      cs[String(c.index ?? 0)] = curName !== sugName && c.status !== 'correct';
    });
    setFieldSel(fs);
    setCreatorSel(cs);
  }, [result]);

  const changeableFields = useMemo(
    () => (result?.fields || []).filter(f => f.suggested !== f.current && f.status !== 'correct'),
    [result]
  );
  const changeableCreators = useMemo(
    () => (result?.creators || []).filter(c => {
      const cur = c.current || {}; const sug = c.suggested || {};
      return [cur.lastName, cur.firstName].join(',') !== [sug.lastName, sug.firstName].join(',') && c.status !== 'correct';
    }),
    [result]
  );

  const selectedFieldCount = Object.values(fieldSel).filter(Boolean).length;
  const selectedCreatorCount = Object.values(creatorSel).filter(Boolean).length;
  const totalSelected = selectedFieldCount + selectedCreatorCount;

  const selectAll = () => {
    const fs = {}; changeableFields.forEach(f => fs[f.field] = true);
    const cs = {}; changeableCreators.forEach(c => cs[String(c.index ?? 0)] = true);
    setFieldSel(fs); setCreatorSel(cs);
  };
  const selectNone = () => { setFieldSel({}); setCreatorSel({}); };

  const handleApply = () => {
    const acceptedFields = {};
    (result?.fields || []).forEach(f => {
      if (fieldSel[f.field]) acceptedFields[f.field] = f.suggested ?? '';
    });
    const acceptedCreators = (result?.creators || [])
      .filter(c => creatorSel[String(c.index ?? 0)])
      .map(c => ({
        firstName: c.suggested?.firstName || '',
        lastName: c.suggested?.lastName || '',
        creatorType: c.suggested?.creatorType || c.current?.creatorType || 'author',
        fieldMode: c.suggested?.fieldMode ?? c.current?.fieldMode ?? 0,
        orderIndex: c.index ?? 0,
      }));
    if (totalSelected === 0) {
      toast.info('未选择任何修改');
      return;
    }
    onApply({ fields: acceptedFields, creators: acceptedCreators });
  };

  const acc = ACCURACY_TEXT[result?.overallAccuracy] || ACCURACY_TEXT.unknown;
  const fieldTotal = result?.fields?.length || 0;
  const creatorTotal = result?.creators?.length || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-5" /> AI 元数据校准
          </DialogTitle>
          <DialogDescription>
            {result ? (
              <>
                整体准确度<span className={`ml-1 font-medium ${acc.cls}`}>{acc.label}</span>
                <span className="text-muted-foreground/80"> · 可在「PDF」标签页对照原文</span>
              </>
            ) : (
              '对比 LLM 建议与当前元数据，勾选要采纳的修改后应用到草稿。'
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            正在调用 LLM 分析全文与元数据，请稍候…
          </div>
        ) : error ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
            <AlertCircle className="size-5 text-destructive" />
            <span className="text-sm text-destructive">{error}</span>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>关闭</Button>
          </div>
        ) : result ? (
          <>
            {/* Action bar */}
            <div className="flex items-center justify-between px-6 py-2 border-b">
              <div className="text-xs text-muted-foreground">
                {fieldTotal} 个字段，<span className="text-amber-600 dark:text-amber-500">{changeableFields.length}</span> 处建议修改
                {creatorTotal > 0 && (
                  <> · {creatorTotal} 位作者，<span className="text-amber-600 dark:text-amber-500">{changeableCreators.length}</span> 处建议修改</>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={selectAll}>全选建议</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={selectNone}>清空</Button>
              </div>
            </div>

            {/* Comparison list */}
            <div className="flex-1 overflow-auto px-6 py-3">
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

              {result.creators && result.creators.length > 0 && (
                <>
                  <h3 className="mb-1 mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">作者</h3>
                  <div className="divide-y">
                    {result.creators.map((c, i) => (
                      <CreatorRow
                        key={i}
                        creator={c}
                        checked={!!creatorSel[String(c.index ?? i)]}
                        onToggle={v => setCreatorSel(s => ({ ...s, [String(c.index ?? i)]: !!v }))}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* LLM I/O tracing panel, collapsed by default */}
            {debugOpen && result?.debug && (
              <div className="max-h-[40vh] overflow-auto border-t bg-muted/30 px-6 py-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    模型 <span className="font-mono text-foreground">{result.debug.model}</span>
                    · 输入 Markdown {result.debug.markdownChars?.toLocaleString()} 字符
                  </span>
                </div>
                <DebugBlock
                  label="System Prompt"
                  content={result.debug.systemPrompt}
                  copied={copiedKey === 'system'}
                  onCopy={t => copyDebug('system', t)}
                />
                <DebugBlock
                  label="User Prompt"
                  content={result.debug.userPrompt}
                  copied={copiedKey === 'user'}
                  onCopy={t => copyDebug('user', t)}
                />
                <DebugBlock
                  label="Raw Response"
                  content={result.debug.rawResponse}
                  copied={copiedKey === 'raw'}
                  onCopy={t => copyDebug('raw', t)}
                />
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t">
              <div className="flex items-center gap-2">
                {result?.debug && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => setDebugOpen(o => !o)}
                  >
                    {debugOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    LLM 输入/输出
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  应用后写入草稿，需在详情页点「保存」才生效
                </span>
              </div>
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
