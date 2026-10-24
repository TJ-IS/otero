import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Checkbox } from './ui/checkbox';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { Globe, Loader2, CheckCircle2, AlertCircle, Users } from 'lucide-react';

const STATUS_VARIANTS = {
  match: { variant: 'secondary' },
  missing: { variant: 'outline', cls: 'text-amber-600 dark:text-amber-500' },
  conflict: { variant: 'destructive' },
};

function StatusBadge({ status }) {
  const { t } = useTranslation('item');
  const m = STATUS_VARIANTS[status] || STATUS_VARIANTS.match;
  return (
    <Badge variant={m.variant} className={`font-normal ${m.cls || ''}`}>
      {t(`crossref.status.${status}`, { defaultValue: status })}
    </Badge>
  );
}

function FieldRow({ field, checked, onToggle }) {
  const { t } = useTranslation(['item', 'common']);
  const changeable = field.status === 'missing' || field.status === 'conflict';
  const fieldLabel = t(`field.${field.field}`, field.field);
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
          <span className="text-sm font-medium">{fieldLabel}</span>
          <StatusBadge status={field.status} />
        </div>
        <div className="mt-1 space-y-0.5 text-xs">
          <div className="text-muted-foreground">
            <span className="text-muted-foreground/80">{t('crossref.current')}</span>
            <span className="break-all">{field.current || <em>{t('crossref.empty')}</em>}</span>
          </div>
          {changeable && (
            <div className="text-foreground">
              <span className="text-muted-foreground/80">{t('crossref.suggestedSource')}</span>
              <span className="break-all font-medium">{field.suggested}</span>
            </div>
          )}
        </div>
      </div>
    </label>
  );
}

export const CrossrefPanel = memo(function CrossrefPanel({
  open,
  onOpenChange,
  result,
  loading,
  error,
  onApply,
}) {
  const { t } = useTranslation(['item', 'common']);
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
    (result.fields || []).forEach((f) => {
      fs[f.field] = f.status === 'missing';
    });
    setFieldSel(fs);
    setApplyCreators(result.creators?.status === 'missing');
    setApplyItemType(
      Boolean(result.suggestedItemType) && result.suggestedItemType !== result.itemType,
    );
  }, [result]);

  const changeableFields = useMemo(
    () => (result?.fields || []).filter((f) => f.status === 'missing' || f.status === 'conflict'),
    [result],
  );
  const conflictFields = useMemo(
    () => (result?.fields || []).filter((f) => f.status === 'conflict'),
    [result],
  );
  const missingFields = useMemo(
    () => (result?.fields || []).filter((f) => f.status === 'missing'),
    [result],
  );

  const selectedFieldCount = Object.values(fieldSel).filter(Boolean).length;
  const totalSelected = selectedFieldCount + (applyCreators ? 1 : 0) + (applyItemType ? 1 : 0);

  const selectFillable = () => {
    const fs = {};
    missingFields.forEach((f) => {
      fs[f.field] = true;
    });
    setFieldSel(fs);
    setApplyCreators(result?.creators?.status === 'missing');
  };
  const selectConflicts = () => {
    const fs = { ...fieldSel };
    conflictFields.forEach((f) => {
      fs[f.field] = true;
    });
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
      toast.info(t('crossref.noSelection'));
      return;
    }
    const acceptedFields = {};
    (result?.fields || []).forEach((f) => {
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

  const creatorsChangeable =
    result?.creators &&
    (result.creators.status === 'missing' || result.creators.status === 'conflict');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-5" /> {t('crossref.title')}
          </DialogTitle>
          <DialogDescription>
            {result ? (
              <>
                DOI <span className="font-mono text-foreground">{result.doi}</span>
                {' · '}
                <span className="text-amber-600 dark:text-amber-500">
                  {t('crossref.summaryMissing', { count: result.summary?.missing || 0 })}
                </span>
                {' · '}
                <span className="text-destructive">
                  {t('crossref.summaryConflict', { count: result.summary?.conflict || 0 })}
                </span>
                {' · '}
                <span className="text-muted-foreground">
                  {t('crossref.summaryMatch', { count: result.summary?.match || 0 })}
                </span>
              </>
            ) : (
              t('crossref.hint')
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            {t('crossref.loading')}
          </div>
        ) : error ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-center px-6">
            <AlertCircle className="size-5 text-destructive" />
            <span className="text-sm text-destructive">{error}</span>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t('common:close')}
            </Button>
          </div>
        ) : result ? (
          <>
            <div className="flex items-center justify-between px-6 py-2 border-b">
              <div className="text-xs text-muted-foreground">
                {changeableFields.length === 0 && !creatorsChangeable
                  ? t('crossref.allMatch')
                  : t('crossref.reviewConflicts')}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={selectFillable}
                >
                  {t('crossref.selectFillable')}
                </Button>
                {conflictFields.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={selectConflicts}
                  >
                    {t('crossref.includeConflicts')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={selectNone}
                >
                  {t('crossref.clear')}
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-3">
              {result.suggestedItemType && result.suggestedItemType !== result.itemType && (
                <label className="flex items-start gap-3 py-2.5 mb-2 hover:bg-accent/40 -mx-2 px-2 rounded-sm">
                  <Checkbox
                    checked={applyItemType}
                    onCheckedChange={(v) => setApplyItemType(!!v)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t('crossref.type')}</span>
                      <StatusBadge status="conflict" />
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {t('crossref.currentType', { type: result.itemType })}
                      <span className="mx-1.5">→</span>
                      <span className="font-medium text-foreground">
                        {result.suggestedItemType}
                      </span>
                    </div>
                  </div>
                </label>
              )}

              <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('crossref.fields')}
              </h3>
              <div className="divide-y">
                {(result.fields || []).map((f) => (
                  <FieldRow
                    key={f.field}
                    field={f}
                    checked={!!fieldSel[f.field]}
                    onToggle={(v) => setFieldSel((s) => ({ ...s, [f.field]: !!v }))}
                  />
                ))}
              </div>

              {result.creators && (
                <>
                  <h3 className="mb-1 mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Users className="size-3.5" /> {t('crossref.authors')}
                  </h3>
                  <label
                    className={`flex items-start gap-3 py-2.5 ${
                      creatorsChangeable ? 'hover:bg-accent/40 -mx-2 px-2 rounded-sm' : 'opacity-60'
                    }`}
                  >
                    <Checkbox
                      checked={applyCreators}
                      onCheckedChange={(v) => setApplyCreators(!!v)}
                      disabled={!creatorsChangeable}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1 text-xs space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{t('crossref.authorList')}</span>
                        <StatusBadge status={result.creators.status} />
                      </div>
                      <div className="text-muted-foreground">
                        <span className="text-muted-foreground/80">{t('crossref.current')}</span>
                        {result.creators.current?.length ? (
                          result.creators.current.map((c) => c.label).join('; ')
                        ) : (
                          <em>{t('crossref.empty')}</em>
                        )}
                      </div>
                      {creatorsChangeable && (
                        <div className="text-foreground">
                          <span className="text-muted-foreground/80">
                            {t('crossref.suggestedSource')}
                          </span>
                          <span className="font-medium">
                            {result.creators.suggested.map((c) => c.label).join('; ')}
                          </span>
                        </div>
                      )}
                      {applyCreators && (
                        <p className="text-amber-600 dark:text-amber-500">
                          {t('crossref.replaceAuthors')}
                        </p>
                      )}
                    </div>
                  </label>
                </>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-3 border-t">
              <span className="text-xs text-muted-foreground">{t('crossref.applyDraftHint')}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  {t('common:cancel')}
                </Button>
                <Button size="sm" onClick={handleApply} disabled={totalSelected === 0}>
                  <CheckCircle2 className="size-3.5" />
                  {t('crossref.applyDraft', { count: totalSelected })}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            {t('crossref.noResult')}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});
