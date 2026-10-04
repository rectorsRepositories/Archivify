// Trigram MATCH narrows common searches. Keep the original substring predicate
// as the final check so punctuation, short queries, and result semantics remain
// unchanged. Restrict MATCH to simple ASCII text to avoid tokenizer edge cases.
function indexedPhrase(query) {
    return /^[a-z0-9 ]{3,}$/i.test(query) ? '"' + query + '"' : null;
}

module.exports = { indexedPhrase };
