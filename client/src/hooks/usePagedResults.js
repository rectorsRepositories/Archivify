import { useEffect, useRef, useState } from 'react'

const PAGE_SIZE = 24

export default function usePagedResults(fetchPage, filters = {}, pageSize = PAGE_SIZE) {
  // Serialize filter values so a caller's new object on each render does not restart the request.
  const key = JSON.stringify(filters)
  const controllerRef = useRef(null)
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState({ items: [], total: 0, loaded: false, loading: true, loadingMore: false, error: '' })

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ items: [], total: 0, loaded: false, loading: true, loadingMore: false, error: '' })
    fetchPage({ ...JSON.parse(key), limit: pageSize, offset: 0 }, { signal: controller.signal })
      .then((page) => setState({ items: page.data, total: page.pagination.total, loaded: true, loading: false, loadingMore: false, error: '' }))
      .catch((error) => {
        if (!controller.signal.aborted) setState({ items: [], total: 0, loaded: true, loading: false, loadingMore: false, error: error.message })
      })
    return () => {
      controller.abort()
      controllerRef.current?.abort()
    }
  }, [fetchPage, key, pageSize, retry])

  async function loadMore() {
    if (state.loading || state.loadingMore || state.items.length >= state.total) return
    const controller = new AbortController()
    controllerRef.current = controller
    setState((current) => ({ ...current, loadingMore: true, error: '' }))
    try {
      const page = await fetchPage({ ...JSON.parse(key), limit: pageSize, offset: state.items.length }, { signal: controller.signal })
      if (!controller.signal.aborted) {
        setState((current) => ({ ...current, items: [...current.items, ...page.data], total: page.pagination.total, loadingMore: false }))
      }
    } catch (error) {
      if (!controller.signal.aborted) setState((current) => ({ ...current, loadingMore: false, error: error.message }))
    }
  }

  return { ...state, hasMore: state.items.length < state.total, loadMore, retry: () => setRetry((count) => count + 1) }
}
