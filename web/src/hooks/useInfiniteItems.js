import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';

/**
 * Infinite-scroll pagination over GET /api/items.
 *
 * Fetches page 1 whenever any of `filter` / `sortField` / `sortDir` / `version`
 * changes (resetting the accumulated list), and appends further pages via
 * loadMore(). Server-side sort means changing the sort re-queries from page 1
 * rather than re-ordering a partial in-memory list.
 *
 * @returns {{
 *   items: object[], total: number, loading: boolean, loadingMore: boolean,
 *   error: Error|null, hasMore: boolean, loadMore: () => void
 * }}
 */
export function useInfiniteItems({ filter = {}, sortField = 'dateModified', sortDir = 'desc', pageSize = 100, version = 0, enabled = true } = {}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  // Guards against out-of-order responses when filters/sort change rapidly.
  const reqIdRef = useRef(0);
  const abortRef = useRef(null);

  const { type, journal, collection, search } = filter;

  const fetchPage = useCallback(async (pageNum, { append }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const reqId = ++reqIdRef.current;
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const res = await api.listItems({
        type, journal, collection, search,
        page: pageNum, pageSize, sortField, sortDir, signal: controller.signal,
      });
      if (reqId !== reqIdRef.current) return; // superseded by a newer request
      setItems(prev => append ? [...prev, ...res.items] : res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
      setPage(res.page);
      setError(null);
    } catch (e) {
      if (reqId !== reqIdRef.current || e.name === 'AbortError') return;
      setError(e);
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [type, journal, collection, search, pageSize, sortField, sortDir]);

  // Reset to page 1 on any filter/sort/version change.
  useEffect(() => {
    if (!enabled) {
      setItems([]); setTotal(0); setTotalPages(0); setPage(1); setLoading(false);
      return;
    }
    fetchPage(1, { append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, journal, collection, search, sortField, sortDir, version, enabled]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const hasMore = page < totalPages;

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    fetchPage(page + 1, { append: true });
  }, [loading, loadingMore, hasMore, page, fetchPage]);

  return { items, total, loading, loadingMore, error, hasMore, loadMore };
}
