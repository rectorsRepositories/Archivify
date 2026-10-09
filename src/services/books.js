const db = require("../db/database");
const { indexedPhrase } = require("./search");

/**
 * @typedef {object} BookFilters
 * @property {string|null} [q] Title, description, contributor, subject, or identifier substring.
 * @property {string|null} [author] Exact author name, ignoring case.
 * @property {string|null} [language] Exact language code, ignoring case.
 * @property {string|null} [subject] Exact subject, ignoring case.
 * @property {number|null} [year] EPUB publication year.
 * @property {'epub'|'txt'|null} [format] Required available format.
 * @property {'title'|'newest'|'oldest'|'added'} [sort] Validated ordering.
 */

/**
 * @typedef {object} PublicBook
 * @property {number} id Stable book ID for a source path.
 * @property {string} title Display title.
 * @property {string|null} subtitle Subtitle.
 * @property {string|null} sort_title Explicit sorting title.
 * @property {string|null} description Embedded description.
 * @property {string|null} publisher Publisher credit.
 * @property {string|null} publication_date EPUB publication date text.
 * @property {number|null} publication_year EPUB publication year.
 * @property {number|null} original_publication_year Explicit original year.
 * @property {string|null} series_name Named series.
 * @property {number|null} series_position Series position.
 * @property {number|null} page_count Explicit page count.
 * @property {string|null} page_count_source Page count origin.
 * @property {number|null} page_marker_count Count of page navigation markers.
 * @property {number|null} word_count Approximate EPUB body word count.
 * @property {string|null} rights Rights statement.
 * @property {string|null} epub_version EPUB package version.
 * @property {string|null} layout Rendition layout.
 * @property {number} created_at First indexing time in milliseconds.
 * @property {number} indexed_at Last successful metadata indexing time in milliseconds.
 * @property {object[]} contributors Ordered contributor credits with MARC roles.
 * @property {string[]} authors Author display names.
 * @property {object[]} identifiers Identifiers and metadata origins.
 * @property {string|null} isbn10 First validated ISBN-10.
 * @property {string|null} isbn13 First validated ISBN-13.
 * @property {string|null} gutenberg_id Gutenberg identifier as text.
 * @property {string[]} languages Language codes.
 * @property {{name: string, vocabulary: string}[]} subjects Subject terms.
 * @property {object[]} formats Indexed EPUB/TXT files and their download URLs.
 * @property {boolean} can_read Whether an EPUB is indexed without a known parsing failure.
 * @property {string|null} artwork_url Cached cover endpoint.
 * @property {string|null} content_url EPUB content endpoint.
 * @property {string|null} download_url Preferred EPUB or TXT download endpoint.
 * @property {'ok'|'error'|'unindexed'} metadata_status Last indexing result.
 * @property {string} [source_key] Relative edition identity, included in details.
 * @property {object} [metadata] Raw fields, origins, and warnings, included in details.
 */

/**
 * Fetch format files for a book, preferring EPUB.
 * @param {number} id Book ID.
 * @returns {object[]} Indexed files with a format field; absolute paths remain internal.
 */
function bookFiles(id) {
    return db.prepare("SELECT f.*, bf.format FROM book_files bf JOIN files f ON f.id = bf.file_id " +
        "WHERE bf.book_id = ? ORDER BY bf.format").all(id);
}

/**
 * Serialize a book without loading cover blobs or exposing absolute paths.
 * @param {object} row Book row with artwork/index status projections.
 * @param {boolean} [detail=false] Include raw metadata and provenance on detail responses.
 * @returns {PublicBook} Book metadata and same-origin delivery URLs.
 */
function publicBook(row, detail = false) {
    const { source_key: sourceKey, metadata_json: metadataJson, has_artwork: hasArtwork,
        index_status: indexStatus, ...book } = row;
    const base = "/api/v1/books/" + row.id;
    book.contributors = db.prepare("SELECT name, sort_name, role, position, authority_id FROM book_contributors WHERE book_id = ? ORDER BY position").all(row.id);
    book.authors = book.contributors.filter((item) => ["aut", "author"].includes(item.role.toLowerCase())).map((item) => item.name);
    book.identifiers = db.prepare("SELECT scheme, value, source FROM book_identifiers WHERE book_id = ? ORDER BY scheme, value").all(row.id);
    book.isbn10 = book.identifiers.find((item) => item.scheme === "isbn10")?.value || null;
    book.isbn13 = book.identifiers.find((item) => item.scheme === "isbn13")?.value || null;
    book.gutenberg_id = book.identifiers.find((item) => item.scheme === "gutenberg")?.value || null;
    book.languages = db.prepare("SELECT code FROM book_languages WHERE book_id = ? ORDER BY code").all(row.id).map((item) => item.code);
    book.subjects = db.prepare("SELECT name, vocabulary FROM book_subjects WHERE book_id = ? ORDER BY name COLLATE NOCASE").all(row.id);
    book.formats = bookFiles(row.id).map((file) => ({
        format: file.format, file_id: file.id, filename: file.filename,
        relative_path: file.relative_path.replace(/\\/g, "/"), size_bytes: file.size,
        modified_at: file.modified_at,
        download_url: base + "/download?format=" + file.format,
    }));
    book.metadata_status = indexStatus || "unindexed";
    book.can_read = book.formats.some((file) => file.format === "epub") && indexStatus === "ok";
    book.artwork_url = hasArtwork ? base + "/artwork" : null;
    book.content_url = book.can_read ? base + "/content" : null;
    book.download_url = book.formats.length ? book.formats[0].download_url : null;
    if (detail) {
        book.source_key = sourceKey;
        book.metadata = JSON.parse(metadataJson);
    }
    return book;
}

const BOOK_COLUMNS = "b.*, EXISTS(SELECT 1 FROM book_artwork ba WHERE ba.book_id = b.id) AS has_artwork, " +
    "(SELECT status FROM book_index_state s WHERE s.book_id = b.id) AS index_status";

/**
 * Query books with substring-compatible metadata search and deterministic pagination.
 * FTS narrows eligible title and contributor matches; other metadata stays searchable.
 * @param {BookFilters} filters Validated search/filter values.
 * @param {{limit: number, offset: number}} page Validated pagination.
 * @returns {{items: PublicBook[], total: number}} Results and pre-pagination total.
 */
function listBooks(filters, page) {
    const conditions = [];
    const values = [];
    if (filters.q) {
        const phrase = indexedPhrase(filters.q);
        const bookCandidate = phrase ? "b.id IN (SELECT rowid FROM books_fts WHERE books_fts MATCH ?) AND " : "";
        const contributorCandidate = phrase ? "c.id IN (SELECT rowid FROM book_contributors_fts WHERE book_contributors_fts MATCH ?) AND " : "";
        conditions.push("((" + bookCandidate + "(instr(lower(b.title), lower(?)) > 0 OR instr(lower(b.subtitle), lower(?)) > 0 " +
            "OR instr(lower(b.description), lower(?)) > 0)) OR EXISTS (SELECT 1 FROM book_contributors c WHERE c.book_id = b.id AND " +
            contributorCandidate + "instr(lower(c.name), lower(?)) > 0) OR EXISTS (SELECT 1 FROM book_identifiers i WHERE i.book_id = b.id " +
            "AND instr(lower(i.value), lower(?)) > 0) OR EXISTS (SELECT 1 FROM book_subjects s WHERE s.book_id = b.id AND instr(lower(s.name), lower(?)) > 0))");
        if (phrase) values.push(phrase);
        values.push(filters.q, filters.q, filters.q);
        if (phrase) values.push(phrase);
        values.push(filters.q, filters.q, filters.q);
    }
    if (filters.author) {
        conditions.push("EXISTS (SELECT 1 FROM book_contributors c WHERE c.book_id = b.id AND lower(c.role) IN ('aut', 'author') AND lower(c.name) = lower(?))");
        values.push(filters.author);
    }
    for (const [key, table, column] of [["language", "book_languages", "code"], ["subject", "book_subjects", "name"], ["format", "book_files", "format"]]) {
        if (!filters[key]) continue;
        conditions.push("EXISTS (SELECT 1 FROM " + table + " r WHERE r.book_id = b.id AND lower(r." + column + ") = lower(?))");
        values.push(filters[key]);
    }
    if (filters.year != null) {
        conditions.push("b.publication_year = ?");
        values.push(filters.year);
    }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const total = db.prepare("SELECT COUNT(*) AS count FROM books b" + where).get(...values).count;
    const titleSort = "COALESCE(b.sort_title, b.title) COLLATE NOCASE, b.id";
    const sorts = { title: titleSort,
        newest: "b.publication_year IS NULL, b.publication_year DESC, " + titleSort,
        oldest: "b.publication_year IS NULL, b.publication_year, " + titleSort,
        added: "b.created_at DESC, b.id DESC" };
    const rows = db.prepare("SELECT " + BOOK_COLUMNS + " FROM books b" + where +
        " ORDER BY " + sorts[filters.sort || "title"] + " LIMIT ? OFFSET ?").all(...values, page.limit, page.offset);
    return { items: rows.map((row) => publicBook(row)), total };
}

/** @param {number} id Book ID. @returns {PublicBook|null} Full metadata and format URLs, if present. */
function getBook(id) {
    const row = db.prepare("SELECT " + BOOK_COLUMNS + " FROM books b WHERE b.id = ?").get(id);
    return row ? publicBook(row, true) : null;
}

/** @returns {{authors: string[], languages: string[], subjects: string[], years: number[]}} Available exact-match filters. */
function bookFacets() {
    return {
        authors: db.prepare("SELECT DISTINCT name FROM book_contributors WHERE lower(role) IN ('aut', 'author') ORDER BY name COLLATE NOCASE").all().map((row) => row.name),
        languages: db.prepare("SELECT DISTINCT code FROM book_languages ORDER BY code").all().map((row) => row.code),
        subjects: db.prepare("SELECT DISTINCT name FROM book_subjects ORDER BY name COLLATE NOCASE").all().map((row) => row.name),
        years: db.prepare("SELECT DISTINCT publication_year FROM books WHERE publication_year IS NOT NULL ORDER BY publication_year DESC").all().map((row) => row.publication_year),
    };
}

/** @param {number} id Book ID. @returns {object|undefined} Cached raster cover with MIME type and checksum. */
function bookArtwork(id) {
    return db.prepare("SELECT mime_type, image_data, checksum FROM book_artwork WHERE book_id = ?").get(id);
}

module.exports = { listBooks, getBook, bookFacets, bookFiles, bookArtwork };
