const db = require("../db/database");
const { indexedPhrase } = require("./search");

const ALBUM_COLUMNS =
    "a.id, a.source_key, a.title, a.release_year, a.genre, " +
    "(SELECT COUNT(*) FROM tracks t WHERE t.album_id = a.id) AS track_count, " +
    "(SELECT CASE WHEN COUNT(*) = COUNT(t.duration_ms) " +
    "THEN COALESCE(SUM(t.duration_ms), 0) ELSE NULL END FROM tracks t " +
    " WHERE t.album_id = a.id) AS duration_ms, " +
    "(SELECT COALESCE(SUM(f.size), 0) FROM tracks t " +
    " JOIN files f ON f.id = t.file_id WHERE t.album_id = a.id) AS size_bytes, " +
    "(a.artwork_file_id IS NOT NULL OR EXISTS " +
    " (SELECT 1 FROM album_artwork aa WHERE aa.album_id = a.id)) AS has_artwork";

const TRACK_COLUMNS =
    "t.id, t.file_id, t.album_id, t.title, t.track_number, t.disc_number, " +
    "t.duration_ms, t.release_year, t.genre, a.title AS album_title, " +
    "f.size AS size_bytes, f.extension, f.relative_path";

const ARTIST_COLUMNS =
    "ar.id, ar.name, " +
    "(SELECT COUNT(*) FROM album_artists aa WHERE aa.artist_id = ar.id) AS album_count, " +
    "(SELECT COUNT(*) FROM track_artists ta WHERE ta.artist_id = ar.id) AS track_count";

/** @typedef {{id: number, name: string}} ArtistRef */

/**
 * @typedef {object} PublicAlbum
 * @property {number} id Album ID.
 * @property {string} source_key Album directory below Music.
 * @property {string} title Album title.
 * @property {number|null} release_year Release year.
 * @property {string|null} genre Genre.
 * @property {ArtistRef[]} artists Album artists.
 * @property {number} track_count Number of tracks.
 * @property {number|null} duration_ms Sum of durations, or null when any is missing.
 * @property {number} size_bytes Sum of track file sizes.
 * @property {string|null} artwork_url Artwork endpoint when available.
 * @property {string} tracks_url Track listing endpoint.
 * @property {string} download_url Album ZIP endpoint.
 */

/**
 * @typedef {object} PublicTrack
 * @property {number} id Track ID.
 * @property {number} file_id Indexed audio file ID.
 * @property {number|null} album_id Album ID, when linked.
 * @property {string|null} album_title Album title, when linked.
 * @property {string} title Track title.
 * @property {number|null} track_number Track number.
 * @property {number|null} disc_number Disc number.
 * @property {number|null} duration_ms Duration in milliseconds.
 * @property {number|null} release_year Release year.
 * @property {string|null} genre Genre.
 * @property {ArtistRef[]} artists Track artists.
 * @property {number} size_bytes File size in bytes.
 * @property {string|null} extension File extension.
 * @property {string} relative_path Slash-separated path below Music.
 * @property {string} content_url Content endpoint.
 * @property {string} download_url Attachment endpoint.
 */

/**
 * @typedef {object} PublicArtist
 * @property {number} id Artist ID.
 * @property {string} name Artist name.
 * @property {number} album_count Linked albums.
 * @property {number} track_count Linked tracks.
 * @property {string} albums_url Filtered album endpoint.
 */

/**
 * @typedef {object} MusicFilters
 * @property {string|null} [q] Title or artist substring.
 * @property {number|null} [artistId] Artist ID.
 * @property {number|null} [albumId] Album ID for track queries.
 * @property {number|null} [year] Release year.
 * @property {string|null} [genre] Case-insensitive genre.
 * @property {'title'|'artist'|'newest'|'oldest'} [sort] Album sort order.
 */

/**
 * Load artists for album IDs in one query, including empty arrays for unmatched IDs.
 * @param {number[]} ids Album IDs.
 * @returns {Map<number, ArtistRef[]>} Artists keyed by album ID.
 */
function artistsByAlbum(ids) {
    const result = new Map(ids.map((id) => [id, []]));

    if (ids.length === 0) {
        return result;
    }

    const placeholders = ids.map(() => "?").join(", ");
    const rows = db.prepare(
        "SELECT aa.album_id, ar.id, ar.name FROM album_artists aa " +
        "JOIN artists ar ON ar.id = aa.artist_id " +
        "WHERE aa.album_id IN (" + placeholders + ") " +
        "ORDER BY ar.name COLLATE NOCASE, ar.id"
    ).all(...ids);

    for (const row of rows) {
        result.get(row.album_id).push({ id: row.id, name: row.name });
    }

    return result;
}

/**
 * Load artists for track IDs in one query, including empty arrays for unmatched IDs.
 * @param {number[]} ids Track IDs.
 * @returns {Map<number, ArtistRef[]>} Artists keyed by track ID.
 */
function artistsByTrack(ids) {
    const result = new Map(ids.map((id) => [id, []]));

    if (ids.length === 0) {
        return result;
    }

    const placeholders = ids.map(() => "?").join(", ");
    const rows = db.prepare(
        "SELECT ta.track_id, ar.id, ar.name FROM track_artists ta " +
        "JOIN artists ar ON ar.id = ta.artist_id " +
        "WHERE ta.track_id IN (" + placeholders + ") " +
        "ORDER BY ar.name COLLATE NOCASE, ar.id"
    ).all(...ids);

    for (const row of rows) {
        result.get(row.track_id).push({ id: row.id, name: row.name });
    }

    return result;
}

/**
 * Add artist lists, aggregate fields, and URLs to album rows.
 * @param {object[]} rows Album query rows.
 * @returns {PublicAlbum[]} Public albums in input order.
 */
function publicAlbums(rows) {
    const artists = artistsByAlbum(rows.map((row) => row.id));

    return rows.map((row) => ({
        id: row.id,
        source_key: row.source_key,
        title: row.title,
        release_year: row.release_year,
        genre: row.genre,
        artists: artists.get(row.id),
        track_count: row.track_count,
        duration_ms: row.duration_ms,
        size_bytes: row.size_bytes,
        artwork_url: row.has_artwork
            ? "/api/v1/music/albums/" + row.id + "/artwork"
            : null,
        tracks_url: "/api/v1/music/albums/" + row.id + "/tracks",
        download_url: "/api/v1/music/albums/" + row.id + "/download",
    }));
}

/**
 * Add artist lists and content URLs to joined track rows.
 * @param {object[]} rows Joined track, file, and album rows.
 * @returns {PublicTrack[]} Public tracks in input order.
 */
function publicTracks(rows) {
    const artists = artistsByTrack(rows.map((row) => row.id));

    return rows.map((row) => ({
        id: row.id,
        file_id: row.file_id,
        album_id: row.album_id,
        album_title: row.album_title,
        title: row.title,
        track_number: row.track_number,
        disc_number: row.disc_number,
        duration_ms: row.duration_ms,
        release_year: row.release_year,
        genre: row.genre,
        artists: artists.get(row.id),
        size_bytes: row.size_bytes,
        extension: row.extension,
        relative_path: row.relative_path.replace(/\\/g, "/"),
        content_url: "/api/v1/files/" + row.file_id + "/content",
        download_url: "/api/v1/files/" + row.file_id + "/download",
    }));
}

/**
 * Query albums by title/artist text and optional artist, year, or genre.
 * Duration is null when any track lacks a duration.
 * @param {MusicFilters} filters Album search and sort options.
 * @param {{limit: number, offset: number}} page Validated pagination.
 * @returns {{items: PublicAlbum[], total: number}} Public albums and pre-pagination count.
 */
function listAlbums(filters, page) {
    const conditions = [];
    const values = [];

    if (filters.q) {
        const phrase = indexedPhrase(filters.q);
        if (phrase) {
            conditions.push(
                "(a.id IN (SELECT rowid FROM albums_fts WHERE albums_fts MATCH ?) " +
                "OR a.id IN (SELECT album_id FROM album_artists WHERE artist_id IN " +
                "(SELECT rowid FROM artists_fts WHERE artists_fts MATCH ?)))"
            );
            values.push(phrase, phrase);
        }
        conditions.push(
            "(instr(lower(a.title), lower(?)) > 0 OR EXISTS " +
            "(SELECT 1 FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id " +
            "WHERE aa.album_id = a.id AND instr(lower(ar.name), lower(?)) > 0))"
        );
        values.push(filters.q, filters.q);
    }

    if (filters.artistId != null) {
        conditions.push(
            "EXISTS (SELECT 1 FROM album_artists aa " +
            "WHERE aa.album_id = a.id AND aa.artist_id = ?)"
        );
        values.push(filters.artistId);
    }

    if (filters.year != null) {
        conditions.push("a.release_year = ?");
        values.push(filters.year);
    }

    if (filters.genre) {
        conditions.push("lower(a.genre) = lower(?)");
        values.push(filters.genre);
    }

    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const total = db.prepare(
        "SELECT COUNT(*) AS count FROM albums a" + where
    ).get(...values).count;
    const sortOrders = {
        title: "a.title COLLATE NOCASE, a.id",
        artist: "COALESCE((SELECT MIN(ar.name COLLATE NOCASE) FROM album_artists aa " +
            "JOIN artists ar ON ar.id = aa.artist_id WHERE aa.album_id = a.id), " +
            "'Unknown artist') COLLATE NOCASE, " +
            "a.title COLLATE NOCASE, a.id",
        newest: "a.release_year IS NULL, a.release_year DESC, a.title COLLATE NOCASE, a.id",
        oldest: "a.release_year IS NULL, a.release_year ASC, a.title COLLATE NOCASE, a.id",
    };
    const rows = db.prepare(
        "SELECT " + ALBUM_COLUMNS + " FROM albums a" + where +
        " ORDER BY " + sortOrders[filters.sort || "title"] + " LIMIT ? OFFSET ?"
    ).all(...values, page.limit, page.offset);

    return { items: publicAlbums(rows), total };
}

/** @returns {{genres: string[], years: number[]}} Available album filters. */
function albumFacets() {
    return {
        genres: db.prepare("SELECT DISTINCT genre FROM albums WHERE genre IS NOT NULL " +
            "AND trim(genre) <> '' ORDER BY genre COLLATE NOCASE")
            .all().map((row) => row.genre),
        years: db.prepare("SELECT DISTINCT release_year FROM albums " +
            "WHERE release_year IS NOT NULL ORDER BY release_year DESC")
            .all().map((row) => row.release_year),
    };
}

/**
 * Fetch one public album by ID.
 * @param {number} id Album ID.
 * @returns {PublicAlbum|null} Album data, if present.
 */
function getAlbum(id) {
    const row = db.prepare(
        "SELECT " + ALBUM_COLUMNS + " FROM albums a WHERE a.id = ?"
    ).get(id);
    return row ? publicAlbums([row])[0] : null;
}

/**
 * Query artists linked to at least one album or track.
 * @param {MusicFilters} filters Optional name substring.
 * @param {{limit: number, offset: number}} page Validated pagination.
 * @returns {{items: PublicArtist[], total: number}} Public artists and pre-pagination count.
 */
function listArtists(filters, page) {
    const conditions = [
        "(EXISTS (SELECT 1 FROM album_artists aa WHERE aa.artist_id = ar.id) " +
        "OR EXISTS (SELECT 1 FROM track_artists ta WHERE ta.artist_id = ar.id))",
    ];
    const values = [];

    if (filters.q) {
        const phrase = indexedPhrase(filters.q);
        if (phrase) {
            conditions.push("ar.id IN (SELECT rowid FROM artists_fts WHERE artists_fts MATCH ?)");
            values.push(phrase);
        }
        conditions.push("instr(lower(ar.name), lower(?)) > 0");
        values.push(filters.q);
    }

    const where = " WHERE " + conditions.join(" AND ");
    const total = db.prepare(
        "SELECT COUNT(*) AS count FROM artists ar" + where
    ).get(...values).count;
    const rows = db.prepare(
        "SELECT " + ARTIST_COLUMNS + " FROM artists ar" + where +
        " ORDER BY ar.name COLLATE NOCASE, ar.id LIMIT ? OFFSET ?"
    ).all(...values, page.limit, page.offset);

    return { items: rows.map(publicArtist), total };
}

/**
 * Add a linked album-list URL to an artist row.
 * @param {object} row Artist query row with album and track counts.
 * @returns {PublicArtist} Public artist data.
 */
function publicArtist(row) {
    return {
        id: row.id,
        name: row.name,
        album_count: row.album_count,
        track_count: row.track_count,
        albums_url: "/api/v1/music/albums?artist_id=" + row.id,
    };
}

/**
 * Fetch one public artist by ID.
 * @param {number} id Artist ID.
 * @returns {PublicArtist|null} Artist data, if present.
 */
function getArtist(id) {
    const row = db.prepare(
        "SELECT " + ARTIST_COLUMNS + " FROM artists ar WHERE ar.id = ?"
    ).get(id);
    return row ? publicArtist(row) : null;
}

/**
 * Query tracks by title/artist text and optional album, artist, year, or genre.
 * @param {MusicFilters} filters Track search options.
 * @param {{limit: number, offset: number}} page Validated pagination.
 * @returns {{items: PublicTrack[], total: number}} Public tracks and pre-pagination count.
 */
function listTracks(filters, page) {
    const conditions = [];
    const values = [];

    if (filters.q) {
        const phrase = indexedPhrase(filters.q);
        if (phrase) {
            conditions.push(
                "(t.id IN (SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ?) " +
                "OR t.id IN (SELECT track_id FROM track_artists WHERE artist_id IN " +
                "(SELECT rowid FROM artists_fts WHERE artists_fts MATCH ?)))"
            );
            values.push(phrase, phrase);
        }
        conditions.push(
            "(instr(lower(t.title), lower(?)) > 0 OR EXISTS " +
            "(SELECT 1 FROM track_artists ta JOIN artists ar ON ar.id = ta.artist_id " +
            "WHERE ta.track_id = t.id AND instr(lower(ar.name), lower(?)) > 0))"
        );
        values.push(filters.q, filters.q);
    }

    if (filters.albumId != null) {
        conditions.push("t.album_id = ?");
        values.push(filters.albumId);
    }

    if (filters.artistId != null) {
        conditions.push(
            "EXISTS (SELECT 1 FROM track_artists ta " +
            "WHERE ta.track_id = t.id AND ta.artist_id = ?)"
        );
        values.push(filters.artistId);
    }

    if (filters.year != null) {
        conditions.push("t.release_year = ?");
        values.push(filters.year);
    }

    if (filters.genre) {
        conditions.push("lower(t.genre) = lower(?)");
        values.push(filters.genre);
    }

    const from =
        " FROM tracks t JOIN files f ON f.id = t.file_id " +
        "LEFT JOIN albums a ON a.id = t.album_id";
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const total = db.prepare(
        "SELECT COUNT(*) AS count" + from + where
    ).get(...values).count;
    const rows = db.prepare(
        "SELECT " + TRACK_COLUMNS + from + where +
        " ORDER BY a.title COLLATE NOCASE, COALESCE(t.disc_number, 1), " +
        "COALESCE(t.track_number, 9999), t.id LIMIT ? OFFSET ?"
    ).all(...values, page.limit, page.offset);

    return { items: publicTracks(rows), total };
}

/**
 * Fetch one public track by ID.
 * @param {number} id Track ID.
 * @returns {PublicTrack|null} Track data, if present.
 */
function getTrack(id) {
    const row = db.prepare(
        "SELECT " + TRACK_COLUMNS +
        " FROM tracks t JOIN files f ON f.id = t.file_id " +
        "LEFT JOIN albums a ON a.id = t.album_id WHERE t.id = ?"
    ).get(id);
    return row ? publicTracks([row])[0] : null;
}

/**
 * Fetch an album's indexed artwork ID and optional embedded image bytes.
 * @param {number} id Album ID.
 * @returns {{artwork_file_id: number|null, mime_type: string|null, image_data: Buffer|null}|undefined} Artwork row, if the album exists.
 */
function getAlbumArtwork(id) {
    return db.prepare(
        "SELECT a.artwork_file_id, aa.mime_type, aa.image_data " +
        "FROM albums a LEFT JOIN album_artwork aa ON aa.album_id = a.id " +
        "WHERE a.id = ?"
    ).get(id);
}

/**
 * List indexed files beneath an album directory, deduplicating relative paths.
 * Includes artwork and other non-audio files for ZIP downloads.
 * @param {string} sourceKey Album directory relative to Music.
 * @returns {Array<{path: string, category: string, relative_path: string, filename: string}>} File rows in path order.
 */
function listAlbumFiles(sourceKey) {
    const rows = db.prepare(
        "SELECT path, category, relative_path, filename FROM files " +
        "WHERE category = 'music' AND " +
        "instr(replace(relative_path, char(92), '/'), ? || '/') = 1 " +
        "ORDER BY relative_path COLLATE NOCASE, id"
    ).all(sourceKey);

    // A database copied between machines may contain both old and new rows
    // for the same relative path. Include each archive file only once.
    return [...new Map(rows.map((row) => [row.relative_path.replace(/\\/g, "/"), row])).values()];
}

module.exports = {
    listAlbums,
    albumFacets,
    getAlbum,
    listArtists,
    getArtist,
    listTracks,
    getTrack,
    getAlbumArtwork,
    listAlbumFiles,
};
