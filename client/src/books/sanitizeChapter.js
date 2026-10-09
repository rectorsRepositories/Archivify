import DOMPurify from 'dompurify'

/**
 * Sanitize EPUB content before it enters a sandboxed iframe. Keep book assets and
 * internal chapter links; block active content, external links, and remote resources.
 * @param {Document} document Detached EPUB chapter document.
 * @param {{url: string}} section EPUB section with a library-generated base URL.
 * @returns {void}
 */
export function sanitizeChapter(document, section) {
  DOMPurify.sanitize(document.documentElement, {
    IN_PLACE: true, WHOLE_DOCUMENT: true, ADD_TAGS: ['link'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'base', 'meta'],
  })
  for (const link of document.querySelectorAll('a[href]')) {
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(link.getAttribute('href').trim())) link.removeAttribute('href')
    link.removeAttribute('target')
    link.removeAttribute('download')
  }
  const head = document.querySelector('head')
  if (!head) return
  const base = document.createElement('base')
  base.setAttribute('href', new URL(section.url, window.location.origin).href)
  head.prepend(base)
  const policy = document.createElement('meta')
  policy.setAttribute('http-equiv', 'Content-Security-Policy')
  policy.setAttribute('content', "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob: data:; font-src blob: data:; media-src blob: data:; base-uri 'self'; form-action 'none'")
  head.prepend(policy)
}
