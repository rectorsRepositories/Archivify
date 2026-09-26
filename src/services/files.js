const db = require("../db/database");

const FILE_COLUMNS =
    "id, path, relative_path, filename, category, extension, " +
    "size, modified_at, indexed_at";

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

function getFile(id) {
    return db.prepare("SELECT " + FILE_COLUMNS + " FROM files WHERE id = ?").get(id);
}

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
    };
}

module.exports = {
    publicFile,
    listFiles,
    getFile,
    librarySummary,
};
