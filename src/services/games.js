const db = require("../db/database");

const GAME_COLUMNS =
    "g.id, g.title, g.platform, g.release_year, g.genre, " +
    "f.id AS file_id, f.filename, f.extension, f.size AS size_bytes, " +
    "f.relative_path, g.artwork_file_id, g.igdb_id, g.igdb_cover_image_id, " +
    "g.summary, g.igdb_url";
const GAME_FROM = " FROM games g JOIN files f ON f.id = g.file_id";

function publicGame(row) {
    return {
        id: row.id,
        title: row.title,
        platform: row.platform,
        release_year: row.release_year,
        genre: row.genre,
        file_id: row.file_id,
        filename: row.filename,
        extension: row.extension,
        size_bytes: row.size_bytes,
        relative_path: row.relative_path.replace(/\\/g, "/"),
        summary: row.summary,
        igdb_id: row.igdb_id,
        igdb_url: row.igdb_url,
        artwork_url: row.artwork_file_id
            ? "/api/v1/files/" + row.artwork_file_id + "/content"
            : row.igdb_cover_image_id
                ? "https://images.igdb.com/igdb/image/upload/t_cover_big/" +
                    encodeURIComponent(row.igdb_cover_image_id) + ".jpg"
                : null,
        download_url: "/api/v1/files/" + row.file_id + "/download",
    };
}

function listGames(filters, page) {
    const conditions = [];
    const values = [];
    if (filters.q) {
        conditions.push("(instr(lower(g.title), lower(?)) > 0 OR instr(lower(g.platform), lower(?)) > 0)");
        values.push(filters.q, filters.q);
    }
    if (filters.platform) {
        conditions.push("lower(g.platform) = lower(?)");
        values.push(filters.platform);
    }
    if (filters.genre) {
        conditions.push("lower(g.genre) = lower(?)");
        values.push(filters.genre);
    }
    if (filters.year != null) {
        conditions.push("g.release_year = ?");
        values.push(filters.year);
    }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const total = db.prepare("SELECT COUNT(*) AS count" + GAME_FROM + where).get(...values).count;
    const rows = db.prepare(
        "SELECT " + GAME_COLUMNS + GAME_FROM + where +
        " ORDER BY g.title COLLATE NOCASE, g.id LIMIT ? OFFSET ?"
    ).all(...values, page.limit, page.offset);
    return { items: rows.map(publicGame), total };
}

function getGame(id) {
    const row = db.prepare("SELECT " + GAME_COLUMNS + GAME_FROM + " WHERE g.id = ?").get(id);
    return row ? publicGame(row) : null;
}

module.exports = { listGames, getGame };
