const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

// -----------------------------------------------------------------------------
// Database path
// -----------------------------------------------------------------------------

/*
 * Default development database:
 *
 * archive-server/
 * └── data/
 *     └── archive.db
 *
 * This can be overridden in production:
 *
 * ARCHIVE_DB=/var/lib/archive-server/archive.db
 */

const DB_PATH = path.resolve(
    process.env.ARCHIVE_DB ||
    path.join(
        __dirname,
        "../../data/archive.db"
    )
);

// -----------------------------------------------------------------------------
// Ensure database directory exists
// -----------------------------------------------------------------------------

const databaseDirectory = path.dirname(
    DB_PATH
);

fs.mkdirSync(
    databaseDirectory,
    {
        recursive: true,
    }
);

// -----------------------------------------------------------------------------
// Open SQLite database
// -----------------------------------------------------------------------------

const db = new Database(DB_PATH);

// -----------------------------------------------------------------------------
// SQLite configuration
// -----------------------------------------------------------------------------

/*
 * WAL mode allows readers and writers to coexist more efficiently.
 *
 * This will be useful once the HTTP server is reading from the database
 * while an indexer may also be updating it.
 */
db.pragma("journal_mode = WAL");

/*
 * SQLite does not enforce foreign keys unless this is enabled.
 */
db.pragma("foreign_keys = ON");

/*
 * Instead of immediately failing if SQLite is temporarily locked,
 * wait up to 5 seconds.
 */
db.pragma("busy_timeout = 5000");

// -----------------------------------------------------------------------------
// Export shared database connection
// -----------------------------------------------------------------------------

module.exports = db;