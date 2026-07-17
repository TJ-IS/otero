import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const STATUS_VARIANTS = {
  correct: { variant: 'secondary' },
  incorrect: { variant: 'destructive' },
  missing: { variant: 'outline', cls: 'text-amber-600 dark:text-amber-500' },
  extra: { variant: 'outline', cls: 'text-muted-foreground' },
};

const ACCURACY_CLS = {
  high: 'text-green-600 dark:text-green-500',
  medium: 'text-amber-600 dark:text-amber-500',
  low: 'text-red-600 dark:text-red-500',
  unknown: 'text-muted-foreground',
};

function StatusBadge({ status }) {
  const { t } = useTranslation('item');
  const m = STATUS_VARIANTS[status] || STATUS_VARIANTS.correct;
  return (
    <Badge variant={m.variant} className={`font-normal ${m.cls || ''}`}>
      {t(`calibrate.status.${status}`, { defaultValue: status })}
    </Badge>
  );
}

function confidencePct(c) {
  const n = typeof c === 'number' ? c : parseFloat(c);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

function DebugBlock({ label, content, copied, onCopy }) {
  const { t } = useTranslation(['item', 'common']);
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
          {copied ? t('common:copied') : t('calibrate.copy')}
        </Button>
      </div>
      <pre className="max-h-[60vh] overflow-auto rounded-md border bg-background p-3 text-xs leading-relaxed whitespace-pre-wrap break-all font-mono">
        {content || t('calibrate.empty')}
      </pre>
    </div>
  );
}

function FieldRow({ field, checked, onToggle }) {
  const { t } = useTranslation('item');
  const changed = field.suggested !== field.current && field.status !== 'correct';
  const pct = confidencePct(field.confidence);
  const isCorrect = field.status === 'correct';
  const fieldLabel = t(`field.${field.field}`, field.field);

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
          <span className="text-sm font-medium">{fieldLabel}</span>
          <StatusBadge status={field.status} />
          {pct != null && (
            <span className="text-xs text-muted-foreground tabular-nums">{t('calibrate.confidencePct', { pct })}</span>
          )}
        </div>
        <div className="mt-1 space-y-0.5 text-xs">
          <div className="text-muted-foreground">
            <span className="text-muted-foreground/80">{t('calibrate.current')}</span>
            <span className="break-all">{field.current || <em>{t('calibrate.empty')}</em>}</span>
          </div>
          {changed && (
            <div className="text-foreground">
              <span className="text-muted-foreground/80">{t('calibrate.suggested')}</span>
              <span className="break-all font-medium">{field.suggested || <em className="text-muted-foreground">{t('calibrate.clearValue')}</em>}</span>
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
  const { t } = useTranslation('item');
  const cur = creator.current || {};
  const sug = creator.suggested || {};
  const curName = [cur.lastName, cur.firstName].filter(Boolean).join(', ') || t('calibrate.empty');
  const sugName = [sug.lastName, sug.firstName].filter(Boolean).join(', ') || t('calibrate.empty');
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
            {t('calibrate.authorN', { n: (creator.index ?? 0) + 1 })}
            <span className="text-muted-foreground font-normal"> · {cur.creatorType || 'author'}</span>
          </span>
          <StatusBadge status={creator.status} />
          {pct != null && (
            <span className="text-xs text-muted-foreground tabular-nums">{t('calibrate.confidencePct', { pct })}</span>
          )}
        </div>
        <div className="mt-1 space-y-0.5 text-xs">
          <div className="text-muted-foreground">
            <span className="text-muted-foreground/80">{t('calibrate.current')}</span>{curName}
          </div>
          {changed && (
            <div className="text-foreground">
              <span className="text-muted-foreground/80">{t('calibrate.suggested')}</span>
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
  const { t } = useTranslation(['item', 'common']);
  const [fieldSel, setFieldSel] = useState({});
  const [creatorSel, setCreatorSel] = useState({});
  const [debugOpen, setDebugOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);

  const copyDebug = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopiedKey(key);
      toast.success(t('common:copied'));
      setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 1500);
    } catch {
      toast.error(t('common:copyFailed'));
    }
  };

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
      toast.info(t('calibrate.noSelection'));
      return;
    }
    onApply({ fields: acceptedFields, creators: acceptedCreators });
  };

  const accuracyKey = result?.overallAccuracy || 'unknown';
  const accCls = ACCURACY_CLS[accuracyKey] || ACCURACY_CLS.unknown;
  const fieldTotal = result?.fields?.length || 0;
  const creatorTotal = result?.creators?.length || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-5" /> {t('calibrate.title')}
          </DialogTitle>
          <DialogDescription>
            {result ? (
              <>
                {t('calibrate.overallAccuracy')}
                <span className={`ml-1 font-medium ${accCls}`}>
                  {t(`calibrate.confidence.${accuracyKey}`, { defaultValue: accuracyKey })}
                </span>
                <span className="text-muted-foreground/80">{t('calibrate.comparePdf')}</span>
              </>
            ) : (
              t('calibrate.hint')
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            {t('calibrate.loading')}
          </div>
        ) : error ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
            <AlertCircle className="size-5 text-destructive" />
            <span className="text-sm text-destructive">{error}</span>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{t('common:close')}</Button>
          </div>
        ) : result ? (
          <>
            <div className="flex items-center justify-between px-6 py-2 border-b">
              <div className="text-xs text-muted-foreground">
                {t('calibrate.fieldSummary', { total: fieldTotal, changes: changeableFields.length })}
                {creatorTotal > 0 && (
                  <> {t('calibrate.creatorSummary', { total: creatorTotal, changes: changeableCreators.length })}</>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={selectAll}>{t('calibrate.selectAll')}</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={selectNone}>{t('calibrate.clear')}</Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-3">
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('calibrate.fields')}</h3>
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
                  <h3 className="mb-1 mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('calibrate.authors')}</h3>
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

            {debugOpen && result?.debug && (
              <div className="max-h-[40vh] overflow-auto border-t bg-muted/30 px-6 py-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {t('calibrate.model')} <span className="font-mono text-foreground">{result.debug.model}</span>
                    {t('calibrate.markdownChars', { count: result.debug.markdownChars?.toLocaleString() ?? 0 })}
                  </span>
                </div>
                <DebugBlock
                  label={t('calibrate.systemPrompt')}
                  content={result.debug.systemPrompt}
                  copied={copiedKey === 'system'}
                  onCopy={text => copyDebug('system', text)}
                />
                <DebugBlock
                  label={t('calibrate.userPrompt')}
                  content={result.debug.userPrompt}
                  copied={copiedKey === 'user'}
                  onCopy={text => copyDebug('user', text)}
                />
                <DebugBlock
                  label={t('calibrate.rawResponse')}
                  content={result.debug.rawResponse}
                  copied={copiedKey === 'raw'}
                  onCopy={text => copyDebug('raw', text)}
                />
              </div>
            )}

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
                    {t('calibrate.io')}
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  {t('calibrate.applyDraftHint')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{t('common:cancel')}</Button>
                <Button size="sm" onClick={handleApply} disabled={totalSelected === 0}>
                  <CheckCircle2 className="size-3.5" />
                  {t('calibrate.applyDraft', { count: totalSelected })}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">{t('calibrate.noResult')}</div>
        )}
      </DialogContent>
    </Dialog>
  );
});
