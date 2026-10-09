const db = require("./database");
const { initializeSearchIndexes } = require("./searchIndex");

// -----------------------------------------------------------------------------
// Database schema
// -----------------------------------------------------------------------------

/**
 * Create archive tables and indexes, then initialize the search indexes.
 * Called when this module loads; existing tables and indexes are retained.
 * @returns {void}
 */
function initializeSchema() {
    db.exec(`
        -- ---------------------------------------------------------------------
        -- Files
        --
        -- Generic filesystem index.
        --
        -- This table knows that a file exists, but does not need to know
        -- whether that file represents a song, game, movie, picture, etc.
        -- ---------------------------------------------------------------------

        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            path TEXT NOT NULL UNIQUE,

            relative_path TEXT NOT NULL,

            filename TEXT NOT NULL,

            category TEXT NOT NULL,

            extension TEXT,

            size INTEGER NOT NULL,

            modified_at INTEGER NOT NULL,

            indexed_at INTEGER NOT NULL
        );


        -- ---------------------------------------------------------------------
        -- Artists
        -- ---------------------------------------------------------------------

        CREATE TABLE IF NOT EXISTS artists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT NOT NULL
                COLLATE NOCASE
                UNIQUE
        );


        -- ---------------------------------------------------------------------
        -- Albums
        --
        -- Artists are intentionally NOT stored directly in this table.
        --
        -- album_artists handles the many-to-many relationship between
        -- albums and artists.
        -- source_key is the path to the album directory relative to Music;
        -- it keeps the album ID stable across rescans and retagging.
        -- Metadata fields are nullable because tags may be absent.
        -- ---------------------------------------------------------------------

        CREATE TABLE IF NOT EXISTS albums (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            source_key TEXT NOT NULL UNIQUE,

            title TEXT NOT NULL,

            release_year INTEGER,

            genre TEXT,

            artwork_file_id INTEGER,

            FOREIGN KEY (artwork_file_id)
                REFERENCES files(id)
                ON DELETE SET NULL
        );


        -- ---------------------------------------------------------------------
        -- Embedded album artwork
        --
        -- Used only when no indexed cover image file is available. Keeping
        -- the image in a separate table avoids loading it in album listings.
        -- ---------------------------------------------------------------------

        CREATE TABLE IF NOT EXISTS album_artwork (
            album_id INTEGER PRIMARY KEY,

            mime_type TEXT NOT NULL,

            image_data BLOB NOT NULL,

            FOREIGN KEY (album_id)
                REFERENCES albums(id)
                ON DELETE CASCADE
        );


        -- ---------------------------------------------------------------------
        -- Tracks
        --
        -- Each music track corresponds to one physical archive file.
        --
        -- file_id is UNIQUE because the same physical file should not become
        -- multiple track records.
        -- ---------------------------------------------------------------------

        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            file_id INTEGER NOT NULL UNIQUE,

            album_id INTEGER,

            title TEXT NOT NULL,

            track_number INTEGER,

            disc_number INTEGER,

            duration_ms INTEGER,

            release_year INTEGER,

            genre TEXT,

            FOREIGN KEY (file_id)
                REFERENCES files(id)
                ON DELETE CASCADE,

            FOREIGN KEY (album_id)
                REFERENCES albums(id)
                ON DELETE SET NULL
        );


        -- ---------------------------------------------------------------------
        -- Album Artists
        --
        -- Junction table allowing:
        --
        -- album <-> artist
        --
        -- to be many-to-many.
        --
        -- Examples:
        --   single artist album
        --   collaborative album
        --   split album
        --   Various Artists compilation
        -- ---------------------------------------------------------------------

        CREATE TABLE IF NOT EXISTS album_artists (
            album_id INTEGER NOT NULL,

            artist_id INTEGER NOT NULL,

            PRIMARY KEY (
                album_id,
                artist_id
            ),

            FOREIGN KEY (album_id)
                REFERENCES albums(id)
                ON DELETE CASCADE,

            FOREIGN KEY (artist_id)
                REFERENCES artists(id)
                ON DELETE CASCADE
        );


        -- ---------------------------------------------------------------------
        -- Track Artists
        --
        -- Individual tracks can also have multiple artists.
        --
        -- This handles featured artists and collaborations independently
        -- from the album artist.
        -- ---------------------------------------------------------------------

        CREATE TABLE IF NOT EXISTS track_artists (
            track_id INTEGER NOT NULL,

            artist_id INTEGER NOT NULL,

            PRIMARY KEY (
                track_id,
                artist_id
            ),

            FOREIGN KEY (track_id)
                REFERENCES tracks(id)
                ON DELETE CASCADE,

            FOREIGN KEY (artist_id)
                REFERENCES artists(id)
                ON DELETE CASCADE
        );


        -- file_id remains the representative entry file for compatibility with
        -- existing databases. game_files contains the complete playable set.
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL UNIQUE,
            source_key TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            platform TEXT NOT NULL,
            release_year INTEGER,
            genre TEXT,
            artwork_file_id INTEGER,
            igdb_id INTEGER,
            igdb_cover_image_id TEXT,
            summary TEXT,
            igdb_url TEXT,
            expected_file_count INTEGER,
            expected_disc_count INTEGER,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
            FOREIGN KEY (artwork_file_id) REFERENCES files(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS game_files (
            game_id INTEGER NOT NULL,
            file_id INTEGER NOT NULL,
            disc_number INTEGER,
            role TEXT NOT NULL CHECK(role IN ('entry', 'data', 'playlist')),
            PRIMARY KEY (game_id, file_id),
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_game_files_file ON game_files(file_id);


        -- ---------------------------------------------------------------------
        -- Files indexes
        -- ---------------------------------------------------------------------

        CREATE INDEX IF NOT EXISTS idx_files_category
            ON files(category);

        CREATE INDEX IF NOT EXISTS idx_files_filename
            ON files(filename);

        CREATE INDEX IF NOT EXISTS idx_files_extension
            ON files(extension);

        CREATE INDEX IF NOT EXISTS idx_files_relative_path
            ON files(relative_path);


        -- ---------------------------------------------------------------------
        -- Album indexes
        -- ---------------------------------------------------------------------

        CREATE INDEX IF NOT EXISTS idx_albums_title
            ON albums(title);

        CREATE INDEX IF NOT EXISTS idx_albums_release_year
            ON albums(release_year);

        CREATE INDEX IF NOT EXISTS idx_albums_genre
            ON albums(genre);

        CREATE INDEX IF NOT EXISTS idx_albums_artwork_file_id
            ON albums(artwork_file_id);


        -- ---------------------------------------------------------------------
        -- Track indexes
        -- ---------------------------------------------------------------------

        CREATE INDEX IF NOT EXISTS idx_tracks_album_id
            ON tracks(album_id);

        CREATE INDEX IF NOT EXISTS idx_tracks_title
            ON tracks(title);


        -- ---------------------------------------------------------------------
        -- Junction table indexes
        --
        -- SQLite already indexes the PRIMARY KEY combinations, but these
        -- additional indexes make reverse lookups efficient.
        -- ---------------------------------------------------------------------

        CREATE INDEX IF NOT EXISTS idx_album_artists_artist
            ON album_artists(artist_id);

        CREATE INDEX IF NOT EXISTS idx_track_artists_artist
            ON track_artists(artist_id);

        CREATE INDEX IF NOT EXISTS idx_games_title ON games(title);
        CREATE INDEX IF NOT EXISTS idx_games_platform ON games(platform);
        CREATE INDEX IF NOT EXISTS idx_games_release_year ON games(release_year);
        CREATE INDEX IF NOT EXISTS idx_games_genre ON games(genre);
    `);
    const gameColumns = new Set(db.prepare("PRAGMA table_info(games)").all().map((row) => row.name));
    if (!gameColumns.has("expected_file_count")) {
        db.exec("ALTER TABLE games ADD COLUMN expected_file_count INTEGER");
    }
    if (!gameColumns.has("expected_disc_count")) {
        db.exec("ALTER TABLE games ADD COLUMN expected_disc_count INTEGER");
    }
    initializeSearchIndexes();
}

// -----------------------------------------------------------------------------
// Initialize automatically when this file is required
// -----------------------------------------------------------------------------

initializeSchema();

// -----------------------------------------------------------------------------
// Export for testing / future migrations
// -----------------------------------------------------------------------------

module.exports = {
    initializeSchema,
};
