export default function PagedFooter({ shown, total, hasMore, loadingMore, error, onLoadMore }) {
  if (!hasMore && !error) return null
  return (
    <div className="paged-footer">
      {error && <p role="alert">{error}</p>}
      {hasMore && <button type="button" className="secondary-button" onClick={onLoadMore} disabled={loadingMore}>
        {loadingMore ? 'Loading more…' : `Load more · ${shown} of ${total}`}
      </button>}
    </div>
  )
}
