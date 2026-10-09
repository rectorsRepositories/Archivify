const assert = require("node:assert/strict");
const fs = require("node:fs");
const { after, before, describe, it } = require("node:test");
const { createFixture, closeFixture, runIndexer, writeMedia, startApi, stopApi, getJson } = require("../test-support/fixture");
const { createEpub, cover } = require("../test-support/epub");

describe("books API", () => {
    let fixture;
    let api;
    let ids;
    let epub;
    let txtPath;

    before(async () => {
        fixture = createFixture();
        epub = await createEpub();
        writeMedia(fixture, "books", "English/Fixture.epub", epub);
        writeMedia(fixture, "books", "English/Fixture.txt", "fixture plain text");
        txtPath = writeMedia(fixture, "books", "Plain.txt", "text only");
        writeMedia(fixture, "books", "Broken.epub", "broken EPUB");
        writeMedia(fixture, "books", "Zeta.epub", await createEpub({ cover: false,
            metadata: '<d:title>Zeta</d:title><d:creator>Carol</d:creator><d:date>1890</d:date><d:language>de</d:language><d:subject>History</d:subject><d:identifier opf:scheme="ISBN">9780306406157</d:identifier>' }));
        assert.equal(runIndexer(fixture, "src/indexers/fileIndexer.js").status, 0);
        const indexed = runIndexer(fixture, "src/indexers/bookIndexer.js");
        assert.equal(indexed.status, 1); // A bad EPUB does not stop valid books being indexed.
        ids = Object.fromEntries(fixture.db.prepare("SELECT source_key, id FROM books").all().map((row) => [row.source_key, row.id]));
        // Test portability when indexed absolute paths come from another machine.
        fixture.db.prepare("UPDATE files SET path = '/Archive/Books/English/Fixture.epub' WHERE relative_path LIKE '%Fixture.epub'").run();
        api = await startApi(fixture.dbPath);
    });

    after(async () => {
        if (api) await stopApi(api.child);
        if (fixture) closeFixture(fixture);
    });

    it("lists one card per edition with formats, nullable metadata, and usable URLs", async () => {
        const { response, body } = await getJson(api.baseUrl, "/api/v1/books?limit=2");
        assert.equal(response.status, 200);
        assert.deepEqual(body.pagination, { limit: 2, offset: 0, total: 4 });
        assert.equal(body.data.length, 2);
        const detail = await getJson(api.baseUrl, "/api/v1/books/" + ids["English/Fixture"]);
        const book = detail.body.data;
        assert.equal(book.title, "Fixture Book");
        assert.deepEqual(book.authors, ["Alice Example"]);
        assert.equal(book.contributors[1].role, "trl");
        assert.equal(book.isbn13, "9780306406157");
        assert.equal(book.gutenberg_id, "123");
        assert.equal(book.page_count, null);
        assert.equal(book.page_marker_count, 2);
        assert.equal(book.can_read, true);
        assert.deepEqual(book.formats.map((item) => item.format), ["epub", "txt"]);
        assert.equal(book.download_url, "/api/v1/books/" + book.id + "/download?format=epub");
        assert.equal(book.content_url, "/api/v1/books/" + book.id + "/content");
        assert.equal(book.artwork_url, "/api/v1/books/" + book.id + "/artwork");
        assert.equal(book.metadata.sources.title, "epub");
        assert.ok(book.metadata.raw.length);
        assert.ok(!JSON.stringify(body).includes(fixture.root));
        assert.ok(!JSON.stringify(detail.body).includes("/Archive/"));
        assert.equal(body.data[0].metadata, undefined);
        const plain = (await getJson(api.baseUrl, "/api/v1/books/" + ids.Plain)).body.data;
        assert.equal(plain.can_read, false);
        assert.equal(plain.content_url, null);
        assert.equal(plain.artwork_url, null);
        assert.equal(plain.publication_year, null);
        assert.match(plain.download_url, /format=txt$/);
        const broken = (await getJson(api.baseUrl, "/api/v1/books/" + ids.Broken)).body.data;
        assert.equal(broken.metadata_status, "error");
        assert.equal(broken.can_read, false);
    });

    it("searches bibliographic metadata and combines exact filters with sorting and pagination", async () => {
        for (const query of ["q=fixture", "q=ali", "q=Al", "q=Bob", "q=searchable", "q=fiction", "q=9780306406157&author=Alice%20Example",
            "author=alice%20example&language=fr&subject=fiction&year=2020&format=txt"]) {
            const { response, body } = await getJson(api.baseUrl, "/api/v1/books?" + query);
            assert.equal(response.status, 200, query);
            assert.deepEqual(body.data.map((item) => item.id), [ids["English/Fixture"]], query);
        }
        assert.equal((await getJson(api.baseUrl, "/api/v1/books?q=9780306406157")).body.pagination.total, 2);
        assert.equal((await getJson(api.baseUrl, "/api/v1/books?author=Bob%20Translator")).body.pagination.total, 0);
        assert.equal((await getJson(api.baseUrl, "/api/v1/books?format=txt")).body.pagination.total, 2);
        const oldest = (await getJson(api.baseUrl, "/api/v1/books?sort=oldest")).body;
        assert.deepEqual(oldest.data.slice(0, 2).map((item) => item.publication_year), [1890, 2020]);
        const newest = (await getJson(api.baseUrl, "/api/v1/books?sort=newest&limit=1&offset=1")).body;
        assert.equal(newest.data[0].id, ids.Zeta);
        assert.deepEqual(newest.pagination, { limit: 1, offset: 1, total: 4 });
        const beyond = (await getJson(api.baseUrl, "/api/v1/books?offset=100")).body;
        assert.deepEqual(beyond.data, []);
        assert.equal(beyond.pagination.total, 4);
        const facets = (await getJson(api.baseUrl, "/api/v1/books/facets")).body.data;
        assert.deepEqual(facets, { authors: ["Alice Example", "Carol"], languages: ["de", "en", "fr"],
            subjects: ["Fiction", "History"], years: [2020, 1890] });
        const summary = (await getJson(api.baseUrl, "/api/v1/library/summary")).body.data;
        assert.deepEqual(summary.books, { titles: 4, authors: 2 });
        assert.equal(summary.categories.find((item) => item.category === "books").file_count, 5);
    });

    it("keeps title and contributor FTS searches synchronized with metadata edits", async () => {
        fixture.db.prepare("UPDATE books SET title = 'Renamed Volume', subtitle = NULL WHERE id = ?").run(ids["English/Fixture"]);
        fixture.db.prepare("UPDATE book_contributors SET name = 'Changed Writer' WHERE name = 'Alice Example'").run();
        for (const [query, total] of [["Fixture Book", 0], ["renamed", 1], ["alice", 0], ["changed", 1], ["Changed W", 1]]) {
            const { body } = await getJson(api.baseUrl, "/api/v1/books?q=" + encodeURIComponent(query));
            assert.equal(body.pagination.total, total, query);
        }
        fixture.db.prepare("UPDATE books SET title = 'Fixture Book' WHERE id = ?").run(ids["English/Fixture"]);
        fixture.db.prepare("UPDATE book_contributors SET name = 'Alice Example' WHERE name = 'Changed Writer'").run();
    });

    it("serves cached covers with HEAD and conditional requests without loading the EPUB", async () => {
        const url = api.baseUrl + "/api/v1/books/" + ids["English/Fixture"] + "/artwork";
        const response = await fetch(url);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "image/png");
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), cover);
        const head = await fetch(url, { method: "HEAD" });
        assert.equal(head.status, 200);
        assert.equal(Number(head.headers.get("content-length")), cover.length);
        assert.equal((await head.arrayBuffer()).byteLength, 0);
        const cached = await fetch(url, { headers: { "If-None-Match": response.headers.get("etag") } });
        assert.equal(cached.status, 304);
        assert.equal((await cached.arrayBuffer()).byteLength, 0);
        assert.equal((await fetch(api.baseUrl + "/api/v1/books/" + ids.Zeta + "/artwork")).status, 404);
    });

    it("streams EPUB content and format downloads with MIME types, byte ranges, and HEAD", async () => {
        const base = api.baseUrl + "/api/v1/books/" + ids["English/Fixture"];
        const content = await fetch(base + "/content");
        assert.equal(content.status, 200);
        assert.equal(content.headers.get("content-type"), "application/epub+zip");
        assert.equal(content.headers.get("content-disposition"), null);
        assert.deepEqual(Buffer.from(await content.arrayBuffer()), epub);
        const range = await fetch(base + "/content", { headers: { Range: "bytes=0-9" } });
        assert.equal(range.status, 206);
        assert.equal(range.headers.get("content-range"), "bytes 0-9/" + epub.length);
        assert.deepEqual(Buffer.from(await range.arrayBuffer()), epub.subarray(0, 10));
        const download = await fetch(base + "/download");
        assert.equal(download.status, 200);
        assert.match(download.headers.get("content-disposition"), /attachment;.*Fixture\.epub/);
        await download.arrayBuffer();
        const text = await fetch(base + "/download?format=txt");
        assert.equal(text.headers.get("content-type"), "text/plain; charset=utf-8");
        assert.equal(await text.text(), "fixture plain text");
        const head = await fetch(base + "/content", { method: "HEAD" });
        assert.equal(Number(head.headers.get("content-length")), epub.length);
        assert.equal((await head.arrayBuffer()).byteLength, 0);
        const plain = await fetch(api.baseUrl + "/api/v1/books/" + ids.Plain + "/download");
        assert.equal(await plain.text(), "text only");
    });

    it("validates filters, IDs, unavailable formats, and missing files", async () => {
        for (const query of ["limit=0", "offset=-1", "year=0", "year=10000", "year=1.5", "sort=bad", "format=pdf", "format=", "q=" + "x".repeat(201)]) {
            const { response, body } = await getJson(api.baseUrl, "/api/v1/books?" + query);
            assert.equal(response.status, 400, query);
            assert.equal(body.error.code, "invalid_parameter");
        }
        for (const endpoint of ["/books/0", "/books/9007199254740992", "/books/" + ids.Plain + "/download?format=pdf", "/books/" + ids.Plain + "/download?format="]) {
            assert.equal((await getJson(api.baseUrl, "/api/v1" + endpoint)).response.status, 400, endpoint);
        }
        for (const endpoint of ["/books/999999", "/books/" + ids.Plain + "/content", "/books/" + ids.Zeta + "/download?format=txt"]) {
            assert.equal((await getJson(api.baseUrl, "/api/v1" + endpoint)).response.status, 404, endpoint);
        }
        const head = await fetch(api.baseUrl + "/api/v1/books", { method: "HEAD" });
        assert.equal(head.status, 200);
        assert.equal(await head.text(), "");
        fs.unlinkSync(txtPath);
        const missing = await getJson(api.baseUrl, "/api/v1/books/" + ids.Plain + "/download");
        assert.equal(missing.response.status, 404);
        assert.equal(missing.body.error.code, "file_unavailable");
    });
});
