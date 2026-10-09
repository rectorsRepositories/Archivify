const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { it } = require("node:test");
const { createFixture, closeFixture, runIndexer, writeMedia } = require("../test-support/fixture");
const { createEpub } = require("../test-support/epub");

/** @param {object} fixture Temporary archive. @param {string[]} [args] Book indexer arguments. @returns {object} Successful child result. */
function indexBooks(fixture, args = []) {
    const files = runIndexer(fixture, "src/indexers/fileIndexer.js");
    assert.equal(files.status, 0, files.stderr);
    const books = runIndexer(fixture, "src/indexers/bookIndexer.js", args);
    assert.equal(books.status, 0, books.stderr);
    return books;
}

it("groups same-stem EPUB/TXT by directory and preserves IDs and timestamps on an unchanged scan", async () => {
    const fixture = createFixture();
    try {
        writeMedia(fixture, "books", "English/Shared.EPUB", await createEpub());
        writeMedia(fixture, "books", "English/Shared.txt", "companion text");
        writeMedia(fixture, "books", "French/Shared.txt", "a separate edition");
        writeMedia(fixture, "books", "English/notes.pdf", "not a book format");
        indexBooks(fixture);
        const first = fixture.db.prepare("SELECT id, source_key, title, indexed_at FROM books ORDER BY source_key").all();
        assert.deepEqual(first.map((row) => [row.source_key, row.title]), [
            ["English/Shared", "Fixture Book"], ["French/Shared", "Shared"],
        ]);
        assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM book_files").get().count, 3);
        assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM book_artwork").get().count, 1);
        const again = indexBooks(fixture);
        assert.match(again.stdout, /unchanged: 2/);
        assert.deepEqual(fixture.db.prepare("SELECT id, source_key, title, indexed_at FROM books ORDER BY source_key").all(), first);
        const forced = indexBooks(fixture, ["--force"]);
        assert.match(forced.stdout, /Books indexed: 2/);
        assert.deepEqual(fixture.db.prepare("SELECT id FROM books ORDER BY source_key").all(), first.map(({ id }) => ({ id })));
    } finally { closeFixture(fixture); }
});

it("applies sidecars, replaces metadata relationships, removes covers, and retries failed refreshes", async () => {
    const fixture = createFixture();
    try {
        const file = writeMedia(fixture, "books", "English/Source.epub", await createEpub());
        const sidecar = writeMedia(fixture, "books", "English/Source.book.json", JSON.stringify({
            title: "Corrected Title", authors: ["Override Writer"], original_publication_year: 1818,
            page_count: 240, languages: ["EN"], subjects: ["Classics"],
            identifiers: [{ scheme: "ISBN", value: "0-306-40615-2" }],
        }));
        indexBooks(fixture);
        const original = fixture.db.prepare("SELECT * FROM books").get();
        assert.equal(original.title, "Corrected Title");
        assert.equal(original.original_publication_year, 1818);
        assert.equal(original.publication_year, 2020);
        assert.equal(original.page_count, 240);
        assert.equal(original.page_count_source, "sidecar");
        assert.equal(JSON.parse(original.metadata_json).sources.title, "sidecar");
        assert.deepEqual(fixture.db.prepare("SELECT name FROM book_contributors").all(), [{ name: "Override Writer" }]);
        assert.equal(fixture.db.prepare("SELECT scheme FROM book_identifiers").get().scheme, "isbn10");

        fs.writeFileSync(sidecar, '{"page_count": "many"}');
        const failed = runIndexer(fixture, "src/indexers/bookIndexer.js");
        assert.equal(failed.status, 1);
        assert.match(failed.stderr, /page_count/);
        assert.equal(fixture.db.prepare("SELECT title FROM books").get().title, "Corrected Title");
        let state = fixture.db.prepare("SELECT * FROM book_index_state").get();
        assert.equal(state.status, "error");
        assert.ok(state.last_success_at);

        fs.writeFileSync(sidecar, JSON.stringify({ title: "Retagged", contributors: [], subjects: [], identifiers: [], page_count: null }));
        fs.writeFileSync(file, await createEpub({ cover: false }));
        indexBooks(fixture);
        assert.equal(fixture.db.prepare("SELECT id, title, page_count FROM books").get().id, original.id);
        assert.equal(fixture.db.prepare("SELECT title FROM books").get().title, "Retagged");
        assert.equal(fixture.db.prepare("SELECT page_count FROM books").get().page_count, null);
        for (const table of ["book_contributors", "book_subjects", "book_identifiers", "book_artwork"]) {
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM " + table).get().count, 0, table);
        }
        state = fixture.db.prepare("SELECT * FROM book_index_state").get();
        assert.equal(state.status, "ok");
        assert.equal(state.error, null);
        fs.unlinkSync(sidecar);
        const restored = runIndexer(fixture, "src/indexers/bookIndexer.js");
        assert.equal(restored.status, 0, restored.stderr);
        assert.equal(fixture.db.prepare("SELECT title FROM books").get().title, "Fixture Book");
    } finally { closeFixture(fixture); }
});

it("indexes TXT-only Gutenberg headers and filename fallbacks while isolating corrupt EPUBs", async () => {
    const fixture = createFixture();
    try {
        writeMedia(fixture, "books", "Header.txt", "Project Gutenberg\nTitle: Header Title\nAuthor: Header Writer\nLanguage: English\nRelease date: Today [eBook #42]\n*** START OF THE PROJECT GUTENBERG EBOOK ***\nAuthor: Body Impostor");
        writeMedia(fixture, "books", "Plain.txt", "plain book text");
        const broken = writeMedia(fixture, "books", "Broken.epub", "corrupt ZIP");
        writeMedia(fixture, "books", "Minimal.epub", await createEpub({ metadata: "", cover: false }));
        assert.equal(runIndexer(fixture, "src/indexers/fileIndexer.js").status, 0);
        const result = runIndexer(fixture, "src/indexers/bookIndexer.js");
        assert.equal(result.status, 1);
        assert.match(result.stdout, /Books indexed: 3/);
        assert.equal(fixture.db.prepare("SELECT title FROM books WHERE source_key = 'Header'").get().title, "Header Title");
        assert.deepEqual(fixture.db.prepare("SELECT name FROM book_contributors").all(), [{ name: "Header Writer" }]);
        assert.deepEqual(fixture.db.prepare("SELECT scheme, value, source FROM book_identifiers").all(), [{ scheme: "gutenberg", value: "42", source: "txt_header" }]);
        assert.deepEqual(fixture.db.prepare("SELECT title FROM books WHERE source_key IN ('Plain', 'Minimal') ORDER BY title").all(), [{ title: "Minimal" }, { title: "Plain" }]);
        fs.writeFileSync(broken, await createEpub());
        const retry = indexBooks(fixture);
        assert.match(retry.stdout, /Books indexed: 1; unchanged: 3; errors: 0/);
    } finally { closeFixture(fixture); }
});

it("preserves book metadata after failed EPUB updates and missing mounts; pruning removes only empty books", async () => {
    const fixture = createFixture();
    try {
        const epub = writeMedia(fixture, "books", "English/Keep.epub", await createEpub());
        const txt = writeMedia(fixture, "books", "English/Keep.txt", "text copy");
        indexBooks(fixture);
        const original = fixture.db.prepare("SELECT * FROM books").get();
        fs.writeFileSync(epub, "corrupt replacement");
        assert.equal(runIndexer(fixture, "src/indexers/bookIndexer.js").status, 1);
        assert.equal(fixture.db.prepare("SELECT metadata_json FROM books").get().metadata_json, original.metadata_json);
        assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM book_artwork").get().count, 1);
        fs.unlinkSync(epub);
        const withoutPrune = runIndexer(fixture, "src/indexers/bookIndexer.js");
        assert.equal(withoutPrune.status, 1);
        assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM book_files").get().count, 2);

        assert.equal(runIndexer(fixture, "src/indexers/fileIndexer.js", ["--prune"]).status, 0);
        const retained = runIndexer(fixture, "src/indexers/bookIndexer.js");
        assert.equal(retained.status, 0, retained.stderr);
        assert.equal(fixture.db.prepare("SELECT id FROM books").get().id, original.id);
        assert.deepEqual(fixture.db.prepare("SELECT format FROM book_files").all(), [{ format: "txt" }]);
        fs.unlinkSync(txt);
        fs.rmdirSync(path.dirname(txt));
        fs.rmdirSync(path.join(fixture.archiveRoot, "Books"));
        const missingMount = runIndexer(fixture, "src/indexers/fileIndexer.js", ["--prune"]);
        assert.equal(missingMount.status, 1); // Existing CLI reports failure when nothing is scanned and a category is missing.
        assert.match(missingMount.stderr, /No archive files were scanned/);
        assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM books").get().count, 1);
        fs.mkdirSync(path.join(fixture.archiveRoot, "Books"));
        assert.equal(runIndexer(fixture, "src/indexers/fileIndexer.js", ["--prune"]).status, 0);
        const removed = runIndexer(fixture, "src/indexers/bookIndexer.js");
        assert.equal(removed.status, 0, removed.stderr);
        assert.match(removed.stdout, /empty books removed: 1/);
        for (const table of ["books", "book_files", "book_artwork", "book_index_state", "book_contributors", "book_identifiers", "book_subjects", "book_languages"]) {
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM " + table).get().count, 0, table);
        }
    } finally { closeFixture(fixture); }
});
