const assert = require("node:assert/strict");
const { it } = require("node:test");
const { createFixture, closeFixture, writeMedia } = require("../test-support/fixture");
const { createEpub, cover } = require("../test-support/epub");
const { readEpubMetadata, normalizeIsbn, identifier, parseXml, memberPath } = require("../src/indexers/epubMetadata");

it("extracts EPUB 3 metadata, contributor refinements, series, raster cover, and page markers", async () => {
    const fixture = createFixture();
    try {
        const file = writeMedia(fixture, "books", "English/Fixture.epub", await createEpub());
        const book = await readEpubMetadata(file);
        assert.equal(book.title, "Fixture Book");
        assert.equal(book.subtitle, "A Test Edition");
        assert.equal(book.sort_title, "Book, Fixture");
        assert.deepEqual(book.contributors.map((item) => [item.name, item.role, item.sort_name]), [
            ["Alice Example", "aut", "Example, Alice"], ["Bob Translator", "trl", null],
        ]);
        assert.deepEqual(book.identifiers, [
            { scheme: "isbn13", value: "9780306406157", source: "epub" },
            { scheme: "gutenberg", value: "123", source: "epub" },
        ]);
        assert.deepEqual(book.languages, ["en", "fr"]);
        assert.deepEqual(book.subjects, [{ name: "Fiction", vocabulary: "" }]);
        assert.equal(book.publication_year, 2020);
        assert.equal(book.original_publication_year, null);
        assert.equal(book.series_name, "Test Series");
        assert.equal(book.series_position, 1.5);
        assert.equal(book.page_count, null); // Page-list entries do not establish a total page count.
        assert.equal(book.page_marker_count, 2);
        assert.equal(book.word_count, 5);
        assert.equal(book.layout, "reflowable");
        assert.deepEqual(book.artwork.imageData, cover);
        assert.equal(book.artwork.mimeType, "image/png");
        assert.ok(book.metadata.raw.some((node) => node.attributes.property === "schema:accessibilityFeature"));
        assert.deepEqual(book.metadata.warnings, []);
    } finally { closeFixture(fixture); }
});

it("reads EPUB 2 attribute roles, legacy covers, NCX page lists, and nullable metadata", async () => {
    const fixture = createFixture();
    try {
        const file = writeMedia(fixture, "books", "Legacy.epub", await createEpub({ version: "2.0",
            metadata: '<d:title>Legacy &amp; Book</d:title><d:creator opf:role="aut" opf:file-as="Writer, A">A Writer</d:creator><d:identifier opf:scheme="ISBN">0-306-40615-2</d:identifier><d:date opf:event="modification">2026-01-01</d:date><d:date opf:event="publication">1901</d:date>' }));
        const book = await readEpubMetadata(file);
        assert.equal(book.title, "Legacy & Book");
        assert.equal(book.epub_version, "2.0");
        assert.equal(book.contributors[0].sort_name, "Writer, A");
        assert.equal(book.identifiers[0].scheme, "isbn10");
        assert.equal(book.publication_year, 1901);
        assert.equal(book.publisher, null);
        assert.deepEqual(book.languages, []);
        assert.equal(book.page_marker_count, 2);
        assert.deepEqual(book.artwork.imageData, cover);
    } finally { closeFixture(fixture); }
});

it("retains invalid identifiers and handles declared page counts without confusing modified dates", async () => {
    const fixture = createFixture();
    try {
        const file = writeMedia(fixture, "books", "Minimal.epub", await createEpub({ cover: false,
            metadata: '<d:identifier opf:scheme="ISBN">9780306406150</d:identifier><meta property="dcterms:modified">2025-01-01</meta><meta property="dcterms:created">1990-01-01</meta><meta property="schema:numberOfPages">123</meta>' }));
        const book = await readEpubMetadata(file);
        assert.equal(book.title, null);
        assert.equal(book.publication_year, null);
        assert.equal(book.original_publication_year, null); // A creation date is not an original print publication date.
        assert.equal(book.page_count, 123);
        assert.equal(book.page_count_source, "epub_metadata");
        assert.equal(book.identifiers[0].scheme, "invalid_isbn");
        assert.equal(book.artwork, null);
    } finally { closeFixture(fixture); }
});

it("isolates missing optional covers and malformed navigation from valid package metadata", async () => {
    const fixture = createFixture();
    try {
        const file = writeMedia(fixture, "books", "Warnings.epub", await createEpub({ files: {
            "EPUB/images/cover.png": null, "EPUB/nav.xhtml": "<broken>",
        } }));
        const book = await readEpubMetadata(file);
        assert.equal(book.title, "Fixture Book");
        assert.equal(book.artwork, null);
        assert.equal(book.page_marker_count, null);
        assert.equal(book.metadata.warnings.length, 2);
    } finally { closeFixture(fixture); }
});

it("rejects corrupt containers, escaping references, oversized XML, and entity declarations", async () => {
    const fixture = createFixture();
    try {
        const corrupt = writeMedia(fixture, "books", "Corrupt.epub", "not a ZIP");
        await assert.rejects(readEpubMetadata(corrupt));
        const escape = writeMedia(fixture, "books", "Escape.epub", await createEpub({
            container: '<container><rootfile full-path="../outside.opf"/></container>',
        }));
        await assert.rejects(readEpubMetadata(escape), /escapes/);
        const oversize = writeMedia(fixture, "books", "Oversize.epub", await createEpub({
            files: { "META-INF/container.xml": " ".repeat(8 * 1024 * 1024 + 1) },
        }));
        await assert.rejects(readEpubMetadata(oversize), /size limits/);
        assert.throws(() => parseXml('<!DOCTYPE root [<!ENTITY secret SYSTEM "file:///secret">]><root>&secret;</root>'), /internal DTD/);
        assert.throws(() => parseXml("<root><child></root>"));
        assert.equal(parseXml('<!DOCTYPE html SYSTEM "https://example.invalid/dtd"><html/>').name, "html");
        for (const href of ["../../../outside", "/absolute", "https://example.com/book", "%2e%2e/%2e%2e/outside", "..\\outside"]) {
            assert.throws(() => memberPath("EPUB/package.opf", href));
        }
        assert.equal(memberPath("EPUB/text/chapter.xhtml", "../images/cover%20art.png#image"), "EPUB/images/cover art.png");
    } finally { closeFixture(fixture); }
});

it("validates ISBN checksums while preserving leading zeros and the ISBN-10 X check digit", () => {
    assert.equal(normalizeIsbn("0-306-40615-2"), "0306406152");
    assert.equal(normalizeIsbn("urn:isbn:9780306406157"), "9780306406157");
    assert.equal(normalizeIsbn("080442957X"), "080442957X");
    assert.equal(normalizeIsbn("9780306406150"), null);
    assert.equal(normalizeIsbn("123"), null);
    assert.equal(identifier("0306406152").scheme, "isbn10");
    assert.equal(identifier("9780306406157", "catalog").scheme, "catalog");
    assert.equal(identifier("urn:isbn:9780306406150").scheme, "invalid_isbn");
    assert.equal(identifier("00042", "gutenberg").value, "42");
    assert.equal(identifier("9007199254740993", "gutenberg").value, "9007199254740993");
});
