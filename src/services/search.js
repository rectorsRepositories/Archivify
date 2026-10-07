// Trigram MATCH narrows common searches. Keep the original substring predicate
// as the final check so punctuation, short queries, and result semantics remain
// unchanged. Restrict MATCH to simple ASCII text to avoid tokenizer edge cases.
/**
 * Produce an FTS phrase for simple ASCII queries of at least three characters.
 * Callers still apply substring matching to preserve exact search behavior.
 * @param {string} query User search text.
 * @returns {string|null} Quoted FTS phrase or null when the index is bypassed.
 */
function indexedPhrase(query) {
    return /^[a-z0-9 ]{3,}$/i.test(query) ? '"' + query + '"' : null;
}

module.exports = { indexedPhrase };
