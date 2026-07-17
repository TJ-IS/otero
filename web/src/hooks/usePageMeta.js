import { useEffect } from 'react';
import { applyPageMeta } from '@/lib/seo';

/**
 * Keep document head in sync with the current SPA route.
 */
export function usePageMeta(meta) {
  const {
    title,
    description,
    canonicalPath,
    robots,
    ogType,
    jsonLd,
  } = meta || {};
  const jsonLdKey = jsonLd == null ? '' : JSON.stringify(jsonLd);

  useEffect(() => {
    applyPageMeta({
      title,
      description,
      canonicalPath,
      robots,
      ogType,
      jsonLd: jsonLdKey ? JSON.parse(jsonLdKey) : null,
    });
  }, [title, description, canonicalPath, robots, ogType, jsonLdKey]);
}
