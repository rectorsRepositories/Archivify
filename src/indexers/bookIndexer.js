const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const db = require("../db/database");
const { resolveArchiveFile } = require("../archivePaths");
const { readEpubMetadata, identifier, dateYear } = require("./epubMetadata");
require("../db/schema");

const PARSER_VERSION = 1;
const SCALAR_FIELDS = ["title", "subtitle", "sort_title", "description", "publisher",
    "publication_date", "publication_year", "original_publication_year", "series_name",
    "series_position", "page_count", "page_count_source", "page_marker_count", "word_count",
    "rights", "epub_version", "layout"];

/**
 * @typedef {object} BookIndexStats
 * @property {number} booksIndexed Sources successfully refreshed.
 * @property {number} unchanged Sources skipped using a successful fingerprint.
 * @property {number} errors Sources that failed without replacing earlier metadata.
 * @property {number} removed Empty book records removed after file pruning.
 */

/**
 * Read a bounded prefix without loading a whole text book or sidecar into memory.
 * @param {string} filePath Existing file path.
 * @param {number} limit Maximum bytes to read.
 * @returns {Promise<Buffer>} File prefix.
 */
async function readPrefix(filePath, limit) {
    const file = await fs.open(filePath, "r");
    try {
        const buffer = Buffer.alloc(limit);
        const { bytesRead } = await file.read(buffer, 0, limit, 0);
        return buffer.subarray(0, bytesRead);
    } finally { await file.close(); }
}

/**
 * Construct nullable metadata with a filename title; no bibliographic data is guessed.
 * @param {string} sourceKey Category-relative path without the file extension.
 * @returns {import('./epubMetadata').BookMetadata} Metadata matching the EPUB reader's output shape.
 */
function fallbackMetadata(sourceKey) {
    return { ...Object.fromEntries(SCALAR_FIELDS.map((field) => [field, null])),
        title: path.posix.basename(sourceKey), contributors: [], identifiers: [],
        subjects: [], languages: [], artwork: null,
        metadata: { raw: [], sources: { title: "filename" }, warnings: [] } };
}

/**
 * Fill missing metadata from a bounded Project Gutenberg header, never the body.
 * @param {import('./epubMetadata').BookMetadata} details Normalized book metadata, mutated in place.
 * @param {string} header First 64 KiB of the companion TXT.
 * @returns {void}
 */
function applyTextHeader(details, header) {
    if (!/Project Gutenberg/i.test(header)) return;
    header = header.split(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG/i)[0];
    const field = (name) => new RegExp("^" + name + ":[ \\t]*(.+)$", "mi").exec(header)?.[1].trim();
    const title = field("Title");
    if (title && details.metadata.sources.title === "filename") {
        details.title = title;
        details.metadata.sources.title = "txt_header";
    }
    const author = field("Author");
    if (!details.contributors.length && author) {
        details.contributors = [{ name: author, sort_name: null, role: "aut", position: 0, authority_id: null }];
        details.metadata.sources.contributors = "txt_header";
    }
    const id = /\beBook\s*#\s*(\d+)/i.exec(header)?.[1];
    if (id && !details.identifiers.some((item) => item.scheme === "gutenberg")) {
        details.identifiers.push(identifier(id, "gutenberg", "txt_header"));
    }
    const language = field("Language");
    const code = ({ english: "en", french: "fr", german: "de", spanish: "es", italian: "it", latin: "la" })[language?.toLowerCase()];
    if (!details.languages.length && code) {
        details.languages = [code];
        details.metadata.sources.languages = "txt_header";
    }
}

/**
 * Validate and apply explicit book sidecar overrides. Null clears optional scalars.
 * Unknown keys are rejected so misspellings cannot silently discard corrections.
 * @param {import('./epubMetadata').BookMetadata} details Normalized metadata, mutated in place.
 * @param {object} overrides Parsed .book.json document.
 * @returns {void}
 * @throws {Error} For unsupported fields or invalid values.
 */
function applyOverrides(details, overrides) {
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new Error("Book sidecar must be an object.");
    const collections = ["contributors", "authors", "identifiers", "subjects", "languages"];
    const integerFields = ["publication_year", "original_publication_year", "page_count", "page_marker_count", "word_count"];
    for (const [key, value] of Object.entries(overrides)) {
        if (![...SCALAR_FIELDS, ...collections].includes(key)) throw new Error("Unknown book sidecar field: " + key);
        if (!SCALAR_FIELDS.includes(key)) continue;
        if (value !== null) {
            if (integerFields.includes(key)) {
                const minimum = key === "word_count" || key === "page_marker_count" ? 0 : 1;
                if (!Number.isSafeInteger(value) || value < minimum || key.endsWith("year") && value > 9999) throw new Error("Invalid book sidecar field: " + key);
            } else if (key === "series_position") {
                if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid series_position.");
            } else if (typeof value !== "string" || !value.trim() || value.length > 100000) {
                throw new Error("Invalid book sidecar field: " + key);
            }
        } else if (key === "title") throw new Error("Book title cannot be null.");
        details[key] = typeof value === "string" ? value.trim() : value;
        details.metadata.sources[key] = "sidecar";
    }
    if (Object.hasOwn(overrides, "publication_date") && !Object.hasOwn(overrides, "publication_year")) {
        details.publication_year = dateYear(details.publication_date);
        details.metadata.sources.publication_year = "sidecar";
    }
    if (Object.hasOwn(overrides, "page_count")) {
        details.page_count_source = details.page_count == null ? null : "sidecar";
    }
    for (const key of collections) {
        if (Object.hasOwn(overrides, key) && !Array.isArray(overrides[key])) throw new Error(key + " must be an array.");
    }
    const strings = (key) => {
        if (overrides[key].some((value) => typeof value !== "string" || !value.trim() || value.length > 1000)) throw new Error("Invalid " + key + ".");
        return [...new Set(overrides[key].map((value) => value.trim()))];
    };
    if (overrides.authors && overrides.contributors) throw new Error("Use authors or contributors, not both.");
    if (overrides.authors) details.contributors = strings("authors").map((name, position) => ({ name, sort_name: null, role: "aut", position, authority_id: null }));
    if (overrides.contributors) {
        details.contributors = overrides.contributors.map((value, position) => {
            if (!value || typeof value.name !== "string" || !value.name.trim() ||
                ["role", "sort_name", "authority_id"].some((key) => value[key] != null && typeof value[key] !== "string")) throw new Error("Invalid contributor.");
            return { name: value.name.trim(), sort_name: value.sort_name || null,
                role: value.role || "aut", authority_id: value.authority_id || null, position };
        });
    }
    if (overrides.subjects) details.subjects = strings("subjects").map((name) => ({ name, vocabulary: "" }));
    if (overrides.languages) details.languages = [...new Set(strings("languages").map((value) => value.toLowerCase()))];
    if (overrides.identifiers) {
        details.identifiers = overrides.identifiers.map((value) => {
            if (!value || typeof value.scheme !== "string" || typeof value.value !== "string" || !value.value.trim()) throw new Error("Invalid identifier.");
            const normalized = identifier(value.value, value.scheme, "sidecar");
            if (normalized.scheme === "invalid_isbn") throw new Error("Invalid ISBN in sidecar.");
            if (normalized.scheme === "gutenberg" && !/^[1-9]\d*$/.test(normalized.value)) throw new Error("Invalid Gutenberg ID in sidecar.");
            return normalized;
        });
    }
    for (const key of collections) {
        if (overrides[key]) details.metadata.sources[key === "authors" ? "contributors" : key] = "sidecar";
    }
}

/**
 * Replace bibliographic relationships and cover data atomically after a successful parse.
 * @param {number} bookId Existing book ID.
 * @param {import('./epubMetadata').BookMetadata} details Fully validated metadata.
 * @param {number} now Indexing timestamp in milliseconds.
 * @returns {void}
 */
function saveMetadata(bookId, details, now) {
    db.prepare("UPDATE books SET " + SCALAR_FIELDS.map((field) => field + " = ?").join(", ") +
        ", metadata_json = ?, indexed_at = ? WHERE id = ?")
        .run(...SCALAR_FIELDS.map((field) => details[field] ?? null), JSON.stringify(details.metadata), now, bookId);
    for (const table of ["book_contributors", "book_identifiers", "book_subjects", "book_languages", "book_artwork"]) {
        db.prepare("DELETE FROM " + table + " WHERE book_id = ?").run(bookId);
    }
    const contributor = db.prepare("INSERT INTO book_contributors (book_id, name, sort_name, role, position, authority_id) VALUES (?, ?, ?, ?, ?, ?)");
    details.contributors.forEach((value, position) => contributor.run(bookId, value.name, value.sort_name, value.role, position, value.authority_id));
    const id = db.prepare("INSERT OR IGNORE INTO book_identifiers (book_id, scheme, value, source) VALUES (?, ?, ?, ?)");
    details.identifiers.forEach((value) => id.run(bookId, value.scheme, value.value, value.source));
    const subject = db.prepare("INSERT OR IGNORE INTO book_subjects (book_id, name, vocabulary) VALUES (?, ?, ?)");
    details.subjects.forEach((value) => subject.run(bookId, value.name, value.vocabulary));
    const language = db.prepare("INSERT OR IGNORE INTO book_languages (book_id, code) VALUES (?, ?)");
    details.languages.forEach((code) => language.run(bookId, code));
    if (details.artwork) db.prepare("INSERT INTO book_artwork (book_id, mime_type, image_data, checksum) VALUES (?, ?, ?, ?)")
        .run(bookId, details.artwork.mimeType, details.artwork.imageData, details.artwork.checksum);
}

/**
 * Save file membership and index state, retaining old metadata on failure.
 * @param {string} sourceKey Relative source identity.
 * @param {object[]} files Indexed format rows.
 * @param {import('./epubMetadata').BookMetadata|null} details Successful metadata, or null on failure.
 * @param {string} fingerprint Current source fingerprint.
 * @param {Error|null} error Source failure.
 * @returns {void}
 */
const saveBook = db.transaction((sourceKey, files, details, fingerprint, error) => {
    const now = Date.now();
    db.prepare("INSERT OR IGNORE INTO books (source_key, title, created_at, indexed_at) VALUES (?, ?, ?, ?)")
        .run(sourceKey, path.posix.basename(sourceKey), now, now);
    const bookId = db.prepare("SELECT id FROM books WHERE source_key = ?").get(sourceKey).id;
    db.prepare("DELETE FROM book_files WHERE book_id = ?").run(bookId);
    const link = db.prepare("INSERT INTO book_files (book_id, file_id, format) VALUES (?, ?, ?)");
    files.forEach((file) => link.run(bookId, file.id, file.extension.slice(1)));
    if (details) saveMetadata(bookId, details, now);
    db.prepare("INSERT INTO book_index_state (book_id, fingerprint, parser_version, status, last_attempt_at, last_success_at, error) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(book_id) DO UPDATE SET fingerprint = excluded.fingerprint, " +
        "parser_version = excluded.parser_version, status = excluded.status, last_attempt_at = excluded.last_attempt_at, " +
        "last_success_at = COALESCE(excluded.last_success_at, book_index_state.last_success_at), error = excluded.error")
        .run(bookId, fingerprint, PARSER_VERSION, error ? "error" : "ok", now, error ? null : now, error?.message || null);
});

/**
 * Index EPUB/TXT editions from generic file records, skipping successful unchanged sources.
 * File pruning is authoritative: missing mounts never trigger book deletion here.
 * @param {{force?: boolean, metadataReader?: function(string): Promise<import('./epubMetadata').BookMetadata>}} [options] Force rebuilding or inject an EPUB reader for tests.
 * @returns {Promise<BookIndexStats>} Indexing and cleanup counters.
 */
async function runBookIndexer({ force = false, metadataReader = readEpubMetadata } = {}) {
    const stats = { booksIndexed: 0, unchanged: 0, errors: 0, removed: 0 };
    const groups = new Map();
    const rows = db.prepare("SELECT * FROM files WHERE category = 'books' AND extension IN ('.epub', '.txt') ORDER BY relative_path, id").all();
    for (const file of rows) {
        const normalized = file.relative_path.replace(/\\/g, "/");
        const key = normalized.slice(0, -file.extension.length);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(file);
    }
    for (const [key, files] of groups) {
        let fingerprint = "";
        try {
            if (new Set(files.map((file) => file.extension)).size !== files.length) throw new Error("Conflicting formats for source: " + key);
            const locations = new Map();
            const signatures = [];
            for (const file of files) {
                const location = resolveArchiveFile(file);
                if (!location) throw new Error("Invalid book file location.");
                const stat = await fs.stat(location);
                if (!stat.isFile()) throw new Error("Book source is not a regular file.");
                locations.set(file.extension, location);
                signatures.push([file.id, file.extension, stat.size, stat.mtimeMs]);
            }
            const first = locations.get(".epub") || locations.get(".txt");
            const sidecarPath = first.slice(0, -path.extname(first).length) + ".book.json";
            let sidecar = null;
            try {
                sidecar = await readPrefix(sidecarPath, 256 * 1024 + 1);
                if (sidecar.length > 256 * 1024) throw new Error("Book sidecar exceeds size limit.");
            } catch (error) { if (error.code !== "ENOENT") throw error; }
            fingerprint = createHash("sha256").update(JSON.stringify(signatures)).update(sidecar || "").digest("hex");
            const state = db.prepare("SELECT s.* FROM book_index_state s JOIN books b ON b.id = s.book_id WHERE b.source_key = ?").get(key);
            if (!force && state?.status === "ok" && state.parser_version === PARSER_VERSION && state.fingerprint === fingerprint) {
                stats.unchanged++;
                continue;
            }
            let details = fallbackMetadata(key);
            if (locations.has(".epub")) {
                const epub = await metadataReader(locations.get(".epub"));
                details = { ...details, ...epub };
                if (!details.title) {
                    details.title = path.posix.basename(key);
                    details.metadata.sources.title = "filename";
                }
            }
            if (locations.has(".txt")) applyTextHeader(details, (await readPrefix(locations.get(".txt"), 64 * 1024)).toString("utf8"));
            if (sidecar) applyOverrides(details, JSON.parse(sidecar.toString("utf8").replace(/^\uFEFF/, "")));
            saveBook(key, files, details, fingerprint, null);
            stats.booksIndexed++;
            console.log("+ books: " + key);
        } catch (error) {
            // A conflicting duplicate must not overwrite a valid membership set.
            if (new Set(files.map((file) => file.extension)).size === files.length) saveBook(key, files, null, fingerprint, error);
            stats.errors++;
            console.error("! books: " + key + ": " + error.message);
        }
    }
    stats.removed = db.prepare("DELETE FROM books WHERE NOT EXISTS (SELECT 1 FROM book_files WHERE book_id = books.id)").run().changes;
    console.log("Books indexed: " + stats.booksIndexed + "; unchanged: " + stats.unchanged +
        "; errors: " + stats.errors + "; empty books removed: " + stats.removed);
    return stats;
}

if (require.main === module) {
    runBookIndexer({ force: process.argv.includes("--force") }).then((stats) => {
        if (stats.errors) process.exitCode = 1;
    }).catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { runBookIndexer, applyTextHeader, applyOverrides, fallbackMetadata };
