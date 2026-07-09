import { memo, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import {
  Dialog, DialogContent, DialogTitle,
} from '@/components/ui/dialog';

// KaTeX CSS — imported once for this view. Vite bundles it.
import 'katex/dist/katex.min.css';

/**
 * Lightweight "image lightbox" using the existing Dialog primitive.
 */
function ImageLightbox({ src, alt, open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 overflow-hidden flex flex-col items-center justify-center">
        <DialogTitle className="sr-only">{alt || '图片预览'}</DialogTitle>
        <img src={src} alt={alt || ''} className="max-w-full max-h-[85vh] object-contain rounded" />
      </DialogContent>
    </Dialog>
  );
}

import { headingId } from '@/lib/fulltext';

export const FulltextMarkdown = memo(function FulltextMarkdown({ markdown, imagesBaseUrl, className = '' }) {
  const [lightbox, setLightbox] = useState({ open: false, src: '', alt: '' });

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
    a: ({ href, children, ...rest }) => (
      <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline" {...rest}>
        {children}
      </a>
    ),
    table: ({ children, ...rest }) => (
      <div className="overflow-x-auto my-4">
        <table {...rest}>{children}</table>
      </div>
    ),
  }), [imagesBaseUrl]);

  return (
    <>
      <article className={`fulltext-prose ${className}`.trim()}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeRaw, rehypeKatex]}
          components={mdComponents}
        >
          {markdown}
        </ReactMarkdown>
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
