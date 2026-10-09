const db = require("../db/database");
const { indexedPhrase } = require("./search");

const GAME_COLUMNS =
    "g.id, g.title, g.platform, g.release_year, g.genre, " +
    "f.id AS file_id, f.filename, f.extension, " +
    "COALESCE((SELECT SUM(member.size) FROM game_files gf " +
    "JOIN files member ON member.id = gf.file_id WHERE gf.game_id = g.id), f.size) AS size_bytes, " +
    "COALESCE(g.expected_disc_count, (SELECT MAX(gf.disc_number) FROM game_files gf WHERE gf.game_id = g.id), 1) AS disc_count, " +
    "COALESCE(g.expected_file_count, NULLIF((SELECT COUNT(*) FROM game_files gf WHERE gf.game_id = g.id), 0), 1) AS file_count, " +
    "CASE WHEN g.expected_file_count IS NULL OR g.expected_file_count = " +
    "(SELECT COUNT(*) FROM game_files gf WHERE gf.game_id = g.id) THEN 1 ELSE 0 END AS is_complete, " +
    "f.relative_path, g.artwork_file_id, g.igdb_id, g.igdb_cover_image_id, " +
    "g.summary, g.igdb_url";
const GAME_FROM = " FROM games g JOIN files f ON f.id = g.file_id";

/**
 * @typedef {object} PublicGame
 * @property {number} id Game ID.
 * @property {string} title Display title.
 * @property {string} platform Platform name.
 * @property {number|null} release_year Release year.
 * @property {string|null} genre Genre.
 * @property {number} file_id Indexed game file ID.
 * @property {string} filename Game filename.
 * @property {string|null} extension Game file extension.
 * @property {number} size_bytes File size in bytes.
 * @property {number} disc_count Number of indexed discs.
 * @property {number} file_count Number of files in the complete game download.
 * @property {boolean} is_complete Whether all indexed file relationships remain available.
 * @property {string} relative_path Slash-separated path below Games.
 * @property {string|null} summary IGDB summary.
 * @property {number|null} igdb_id IGDB game ID.
 * @property {string|null} igdb_url IGDB page URL.
 * @property {string|null} artwork_url Local cover or IGDB cover URL.
 * @property {string} download_url Game file download URL.
 */

/**
 * @typedef {object} GameFilters
 * @property {string|null} [q] Title or platform substring.
 * @property {string|null} [platform] Case-insensitive platform match.
 * @property {string|null} [genre] Case-insensitive genre match.
 * @property {number|null} [year] Release year.
 * @property {'title'|'newest'|'oldest'} [sort] Validated sort order.
 */

/**
 * Format a joined game row, preferring local artwork over an IGDB cover URL.
 * @param {object} row Joined games/files query row.
 * @returns {PublicGame} Public game data and download/artwork URLs.
 */
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
        disc_count: row.disc_count,
        file_count: row.file_count,
        is_complete: Boolean(row.is_complete),
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
        download_url: "/api/v1/games/" + row.id + "/download",
    };
}

/**
 * Query games with validated filters and sorting.
 * @param {GameFilters} filters Game search and sort options.
 * @param {{limit: number, offset: number}} page Validated pagination.
 * @returns {{items: PublicGame[], total: number}} Public games and pre-pagination count.
 */
function listGames(filters, page) {
    const conditions = [];
    const values = [];
    if (filters.q) {
        const phrase = indexedPhrase(filters.q);
        if (phrase) {
            conditions.push("g.id IN (SELECT rowid FROM games_fts WHERE games_fts MATCH ?)");
            values.push(phrase);
        }
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
    const sortOrders = {
        title: "g.title COLLATE NOCASE, g.id",
        newest: "g.release_year IS NULL, g.release_year DESC, g.title COLLATE NOCASE, g.id",
        oldest: "g.release_year IS NULL, g.release_year ASC, g.title COLLATE NOCASE, g.id",
    };
    const rows = db.prepare(
        "SELECT " + GAME_COLUMNS + GAME_FROM + where +
        " ORDER BY " + sortOrders[filters.sort || "title"] + " LIMIT ? OFFSET ?"
    ).all(...values, page.limit, page.offset);
    return { items: rows.map(publicGame), total };
}

/** @returns {{platforms: string[], genres: string[]}} Available game filters. */
function gameFacets() {
    return {
        platforms: db.prepare("SELECT DISTINCT platform FROM games ORDER BY platform COLLATE NOCASE")
            .all().map((row) => row.platform),
        genres: db.prepare("SELECT DISTINCT genre FROM games WHERE genre IS NOT NULL " +
            "AND trim(genre) <> '' ORDER BY genre COLLATE NOCASE")
            .all().map((row) => row.genre),
    };
}

/**
 * Fetch one public game by ID.
 * @param {number} id Game ID.
 * @returns {PublicGame|null} Game data, if present.
 */
function getGame(id) {
    const row = db.prepare("SELECT " + GAME_COLUMNS + GAME_FROM + " WHERE g.id = ?").get(id);
    if (!row) return null;
    const game = publicGame(row);
    const members = listGameFiles(id);
    game.files = members.map((member) => ({ id: member.id, filename: member.filename,
        relative_path: member.relative_path.replace(/\\/g, "/"),
        size_bytes: member.size, disc_number: member.disc_number, role: member.role,
        download_url: "/api/v1/files/" + member.id + "/download" }));
    game.discs = [];
    for (const member of game.files) {
        if (member.disc_number == null) continue;
        let disc = game.discs.find((item) => item.number === member.disc_number);
        if (!disc) {
            disc = { number: member.disc_number, files: [] };
            game.discs.push(disc);
        }
        disc.files.push(member);
    }
    return game;
}

function listGameFiles(id) {
    const members = db.prepare(
        "SELECT f.*, gf.disc_number, gf.role FROM game_files gf " +
        "JOIN files f ON f.id = gf.file_id WHERE gf.game_id = ? " +
        "ORDER BY gf.disc_number IS NULL DESC, gf.disc_number, " +
        "CASE gf.role WHEN 'entry' THEN 0 ELSE 1 END, f.relative_path COLLATE NOCASE"
    ).all(id);
    if (members.length) return members;
    const file = db.prepare("SELECT f.*, 1 AS disc_number, 'entry' AS role " +
        "FROM games g JOIN files f ON f.id = g.file_id WHERE g.id = ?").get(id);
    return file ? [file] : [];
}

module.exports = { listGames, gameFacets, getGame, listGameFiles };
