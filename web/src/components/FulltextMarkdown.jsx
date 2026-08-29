import { lazy, memo, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import DOMPurify from 'dompurify';
import {
  Dialog, DialogContent, DialogTitle,
} from '@/components/ui/dialog';
import { headingId } from '@/lib/fulltext';
import { buildReferenceIndex, rehypeCitations } from '@/lib/citations';
import { CitationRef } from './CitationRef';

// KaTeX CSS — imported once for this view. Vite bundles it.
import 'katex/dist/katex.min.css';

/**
 * Lightweight "image lightbox" using the existing Dialog primitive.
 */
function ImageLightbox({ src, alt, open, onOpenChange }) {
  const { t } = useTranslation('item');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 overflow-hidden flex flex-col items-center justify-center">
        <DialogTitle className="sr-only">{alt || t('page.imagePreview')}</DialogTitle>
        <img src={src} alt={alt || ''} className="max-w-full max-h-[85vh] object-contain rounded" />
      </DialogContent>
    </Dialog>
  );
}

const MathMarkdown = lazy(() => import('./MathMarkdown').then(module => ({ default: module.MathMarkdown })));

function containsMath(markdown) {
  return /\$\$|\$[^$\n]+\$|\\\(|\\\[/.test(markdown);
}

export const FulltextMarkdown = memo(function FulltextMarkdown({
  markdown,
  imagesBaseUrl,
  className = '',
  references,
  onCiteJump,
}) {
  const { t } = useTranslation('item');
  const [lightbox, setLightbox] = useState({ open: false, src: '', alt: '' });

  // MinerU output is imported content. Keep supported HTML (notably tables)
  // while removing executable markup before rehypeRaw turns it into React nodes.
  const safeMarkdown = useMemo(() => DOMPurify.sanitize(markdown || '', {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
  }), [markdown]);
  const hasMath = useMemo(() => containsMath(safeMarkdown), [safeMarkdown]);
  const refIndex = useMemo(() => buildReferenceIndex(references), [references]);
  const refById = useMemo(
    () => new Map((references || []).map((r) => [r.id, r])),
    [references],
  );
  const extraRehypePlugins = useMemo(
    () => [[rehypeCitations, refIndex]],
    [refIndex],
  );

  const mdComponents = useMemo(() => ({
    h1: ({ children, ...rest }) => <h1 id={headingId(children)} {...rest}>{children}</h1>,
    h2: ({ children, ...rest }) => <h2 id={headingId(children)} {...rest}>{children}</h2>,
    h3: ({ children, ...rest }) => <h3 id={headingId(children)} {...rest}>{children}</h3>,
    h4: ({ children, ...rest }) => <h4 id={headingId(children)} {...rest}>{children}</h4>,
    h5: ({ children, ...rest }) => <h5 id={headingId(children)} {...rest}>{children}</h5>,
    h6: ({ children, ...rest }) => <h6 id={headingId(children)} {...rest}>{children}</h6>,
    img: ({ src, alt, ...rest }) => {
      const fullSrc = src?.startsWith('http') || src?.startsWith('/')
        ? src
        : `${imagesBaseUrl || ''}/${String(src).replace(/^\.\//, '')}`;
      return (
        <span className="block my-4">
          <img
            src={fullSrc}
            alt={alt || ''}
            loading="lazy"
            className="max-w-full rounded-md border cursor-zoom-in hover:opacity-90 transition-opacity mx-auto"
            onClick={() => setLightbox({ open: true, src: fullSrc, alt: alt || '' })}
            {...rest}
          />
          {alt && <span className="block text-center text-xs text-muted-foreground mt-1">{alt}</span>}
        </span>
      );
    },
    a: ({ href, children, node: _node, className: linkClass, ...rest }) => {
      const refIds = rest['data-ref-ids'];
      if (refIds) {
        const refs = String(refIds)
          .split(',')
          .map((id) => refById.get(id))
          .filter(Boolean);
        if (refs.length) {
          return <CitationRef refs={refs} onNavigate={onCiteJump}>{children}</CitationRef>;
        }
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" className={linkClass || 'text-brand hover:underline'} {...rest}>
          {children}
        </a>
      );
    },
    table: ({ children, ...rest }) => (
      <div className="overflow-x-auto my-4">
        <table {...rest}>{children}</table>
      </div>
    ),
  }), [imagesBaseUrl, onCiteJump, refById]);

  return (
    <>
      <article className={`fulltext-prose min-w-0 max-w-full overflow-x-hidden ${className}`.trim()}>
        {hasMath ? (
          <Suspense fallback={<p className="py-4 text-sm text-muted-foreground">{t('page.loadingMath')}</p>}>
            <MathMarkdown
              markdown={safeMarkdown}
              components={mdComponents}
              extraRehypePlugins={extraRehypePlugins}
            />
          </Suspense>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, ...extraRehypePlugins]}
            components={mdComponents}
          >
            {safeMarkdown}
          </ReactMarkdown>
        )}
      </article>
      <ImageLightbox
        src={lightbox.src}
        alt={lightbox.alt}
        open={lightbox.open}
        onOpenChange={(open) => setLightbox(s => ({ ...s, open }))}
      />
    </>
  );
});
