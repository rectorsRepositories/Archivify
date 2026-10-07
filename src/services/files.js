const db = require("../db/database");
const { indexedPhrase } = require("./search");

/**
 * @typedef {object} IndexedFile Row from the files table.
 * @property {number} id Database ID.
 * @property {string} path Indexed absolute path.
 * @property {string} relative_path Path below the category root.
 * @property {string} filename Basename.
 * @property {string} category Archive category.
 * @property {string|null} extension Lowercase extension, including the dot.
 * @property {number} size Size in bytes.
 * @property {number} modified_at Modification time in integer milliseconds.
 * @property {number} indexed_at Last insert or changed-file indexing time in milliseconds.
 */

/**
 * @typedef {object} PublicFile
 * @property {number} id File ID.
 * @property {string} relative_path Slash-separated relative path.
 * @property {string} filename Basename.
 * @property {string} category Archive category.
 * @property {string|null} extension File extension.
 * @property {number} size_bytes File size in bytes.
 * @property {number} modified_at Modification time in milliseconds.
 * @property {number} indexed_at Last indexing time in milliseconds.
 * @property {string} content_url Content endpoint.
 * @property {string} download_url Attachment endpoint.
 */

/**
 * @typedef {object} FileFilters
 * @property {string|null} [q] Filename or relative-path substring.
 * @property {string|null} [category] Exact category.
 * @property {string|null} [extension] Case-insensitive extension, with or without dot.
 * @property {string|null} [path] Relative directory prefix or exact path.
 */

const FILE_COLUMNS =
    "id, path, relative_path, filename, category, extension, " +
    "size, modified_at, indexed_at";

/**
 * Convert a file row to the API shape and normalize path separators.
 * @param {IndexedFile} row Database row.
 * @returns {PublicFile} Public file data and content/download URLs.
 */
function publicFile(row) {
    return {
        id: row.id,
        relative_path: row.relative_path.replace(/\\/g, "/"),
        filename: row.filename,
        category: row.category,
        extension: row.extension,
        size_bytes: row.size,
        modified_at: row.modified_at,
        indexed_at: row.indexed_at,
        content_url: "/api/v1/files/" + row.id + "/content",
        download_url: "/api/v1/files/" + row.id + "/download",
    };
}

/**
 * Query files with optional substring and path-prefix filters.
 * @param {FileFilters} filters File search filters.
 * @param {{limit: number, offset: number}} page Validated pagination.
 * @returns {{items: PublicFile[], total: number}} Public files and pre-pagination count.
 */
function listFiles(filters, page) {
    const conditions = [];
    const values = [];

    if (filters.category) {
        conditions.push("category = ?");
        values.push(filters.category);
    }

    if (filters.extension) {
        conditions.push("lower(extension) = lower(?)");
        values.push(
            filters.extension.startsWith(".") ? filters.extension : "." + filters.extension
        );
    }

    if (filters.q) {
        const phrase = indexedPhrase(filters.q);
        if (phrase) {
            conditions.push("id IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)");
            values.push(phrase);
        }
        conditions.push(
            "(instr(lower(filename), lower(?)) > 0 " +
            "OR instr(lower(relative_path), lower(?)) > 0)"
        );
        values.push(filters.q, filters.q);
    }

    if (filters.path) {
        const prefix = filters.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        const normalizedPath = "replace(relative_path, char(92), '/')";
        conditions.push(
            "(" + normalizedPath + " = ? OR instr(" + normalizedPath + ", ? || '/') = 1)"
        );
        values.push(prefix, prefix);
    }

    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const total = db.prepare("SELECT COUNT(*) AS count FROM files" + where).get(...values).count;
    const rows = db.prepare(
        "SELECT " + FILE_COLUMNS + " FROM files" + where +
        " ORDER BY category, relative_path COLLATE NOCASE, id LIMIT ? OFFSET ?"
    ).all(...values, page.limit, page.offset);

    return { items: rows.map(publicFile), total };
}

/**
 * Fetch an indexed file by database ID.
 * @param {number} id File ID.
 * @returns {IndexedFile|undefined} File row, if present.
 */
function getFile(id) {
    return db.prepare("SELECT " + FILE_COLUMNS + " FROM files WHERE id = ?").get(id);
}

/**
 * Aggregate file counts and sizes plus indexed music and game totals.
 * @returns {object} Category, music, and game summary data.
 */
function librarySummary() {
    const categories = db.prepare(
        "SELECT category, COUNT(*) AS file_count, " +
        "COALESCE(SUM(size), 0) AS size_bytes " +
        "FROM files GROUP BY category ORDER BY category"
    ).all();

    return {
        categories,
        music: {
            artists: db.prepare("SELECT COUNT(*) AS count FROM artists").get().count,
            albums: db.prepare("SELECT COUNT(*) AS count FROM albums").get().count,
            tracks: db.prepare("SELECT COUNT(*) AS count FROM tracks").get().count,
            duration_ms: db.prepare(
                "SELECT COALESCE(SUM(duration_ms), 0) AS total FROM tracks"
            ).get().total,
        },
        games: {
            titles: db.prepare("SELECT COUNT(*) AS count FROM games").get().count,
            platforms: db.prepare("SELECT COUNT(DISTINCT platform) AS count FROM games").get().count,
        },
    };
}

module.exports = {
    publicFile,
    listFiles,
    getFile,
    librarySummary,
};
