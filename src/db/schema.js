const db = require("./database");

// -----------------------------------------------------------------------------
// Database schema
// -----------------------------------------------------------------------------

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
        -- ---------------------------------------------------------------------

        CREATE TABLE IF NOT EXISTS albums (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            title TEXT NOT NULL
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
    `);
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