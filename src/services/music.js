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

function getAlbum(id) {
    const row = db.prepare(
        "SELECT " + ALBUM_COLUMNS + " FROM albums a WHERE a.id = ?"
    ).get(id);
    return row ? publicAlbums([row])[0] : null;
}

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

function publicArtist(row) {
    return {
        id: row.id,
        name: row.name,
        album_count: row.album_count,
        track_count: row.track_count,
        albums_url: "/api/v1/music/albums?artist_id=" + row.id,
    };
}

function getArtist(id) {
    const row = db.prepare(
        "SELECT " + ARTIST_COLUMNS + " FROM artists ar WHERE ar.id = ?"
    ).get(id);
    return row ? publicArtist(row) : null;
}

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

function getTrack(id) {
    const row = db.prepare(
        "SELECT " + TRACK_COLUMNS +
        " FROM tracks t JOIN files f ON f.id = t.file_id " +
        "LEFT JOIN albums a ON a.id = t.album_id WHERE t.id = ?"
    ).get(id);
    return row ? publicTracks([row])[0] : null;
}

function getAlbumArtwork(id) {
    return db.prepare(
        "SELECT a.artwork_file_id, aa.mime_type, aa.image_data " +
        "FROM albums a LEFT JOIN album_artwork aa ON aa.album_id = a.id " +
        "WHERE a.id = ?"
    ).get(id);
}

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
