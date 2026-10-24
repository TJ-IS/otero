import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/ui/async-states';
import { ITEM_TYPE_LABELS, itemTitle, UNFILED, yearOf } from '@/lib/items';
import { AuthorLinks } from './AuthorLinks';

const JATS_OR_HTML_TAG = /<\/?(?:jats:)?[a-z][\w:-]*\b[^>]*>/gi;
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    const key = entity.toLowerCase();
    if (NAMED_ENTITIES[key]) return NAMED_ENTITIES[key];
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return '';
  });
}

export function cleanRichText(raw) {
  if (!raw) return '';
  return decodeEntities(String(raw).replace(JATS_OR_HTML_TAG, ' '))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function isDoiUrl(url, doi) {
  if (!url || !doi) return false;
  const normalized = url.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/\/$/, '');
  return normalized.toLowerCase() === doi.toLowerCase();
}

function venueValue(fields, t) {
  const raw =
    fields.publicationTitle ||
    fields.bookTitle ||
    fields.conferenceName ||
    fields.proceedingsTitle ||
    fields.repository ||
    fields.university ||
    fields.publisher ||
    '';
  if (!raw) return null;
  if (raw === UNFILED) return t('common:unfiled');
  return raw;
}

export function ItemPublicCardSkeleton() {
  return <LoadingSkeleton variant="lines" className="px-2 py-2" />;
}

export const ItemPublicCard = memo(function ItemPublicCard({ item }) {
  const { t } = useTranslation(['item', 'common']);
  if (!item) return <ItemPublicCardSkeleton />;

  const f = item.fields || {};
  const title = itemTitle(item);
  const typeLabel = ITEM_TYPE_LABELS[item.itemType] || item.itemType;
  const year = yearOf(f.date);
  const doi = (f.DOI || '').trim();
  const url = (f.url || '').trim();
  const showUrl = url && !isDoiUrl(url, doi);
  const authors = item.creators || [];
  const venue = venueValue(f, t);
  const locator = [
    f.volume && `Vol. ${f.volume}`,
    f.issue && `No. ${f.issue}`,
    f.pages && `pp. ${f.pages}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const citation = [venue, locator].filter(Boolean).join('  ·  ');
  const abstract = cleanRichText(f.abstractNote);

  return (
    <article className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-6 sm:px-8 sm:pt-7">
        <header className="pr-8 text-left">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-brand">
              {typeLabel}
            </p>
            {year ? (
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {year}
              </span>
            ) : null}
          </div>
          <h2 className="mt-3 font-display text-[1.65rem] font-semibold leading-[1.2] tracking-tight text-balance sm:text-[1.85rem]">
            {title}
          </h2>
          {authors.length > 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              <AuthorLinks creators={authors} />
            </p>
          ) : null}
          {citation ? (
            <p className="mt-4 max-w-[65ch] text-sm leading-relaxed text-foreground/80">
              {citation}
            </p>
          ) : null}
        </header>

        {doi || showUrl ? (
          <div className="mt-5 border-t border-border/80 pt-4 text-sm">
            {doi ? (
              <p>
                <span className="mr-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {t('field.DOI')}
                </span>
                <a
                  href={`https://doi.org/${doi}`}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-brand transition-colors hover:underline"
                >
                  {doi}
                </a>
              </p>
            ) : null}
            {showUrl ? (
              <p className={doi ? 'mt-2' : undefined}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-brand transition-colors hover:underline"
                >
                  {url}
                </a>
              </p>
            ) : null}
          </div>
        ) : null}

        {abstract ? (
          <section className="mt-6 border-t border-border/80 pt-5 pb-2">
            <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t('detail.abstract')}
            </h3>
            <p className="max-w-[65ch] whitespace-pre-wrap font-serif text-[15px] leading-7 text-foreground/90">
              {abstract}
            </p>
          </section>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border/80 bg-card px-6 py-4 sm:px-8">
        <Button asChild>
          <Link to={`/items/${item.key}`} target="_blank" rel="noreferrer">
            {t('detail.readPage')}
            <ArrowUpRight className="size-4" />
          </Link>
        </Button>
      </div>
    </article>
  );
});
