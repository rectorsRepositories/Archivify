const fs = require("node:fs");
const path = require("node:path");

const db = require("../db/database");
const { archiveRoot: ARCHIVE_ROOT } = require("../archivePaths");

// Ensure the database schema exists before indexing.
require("../db/schema");

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

/*
 * Keep these names matched to the actual capitalization
 * used on the Ubuntu archive server.
 */
const ARCHIVE_DIRECTORIES = {
    music: path.join(ARCHIVE_ROOT, "Music"),
    games: path.join(ARCHIVE_ROOT, "Games"),
    books: path.join(ARCHIVE_ROOT, "Books"),
    pictures: path.join(ARCHIVE_ROOT, "Pictures"),
    videos: path.join(ARCHIVE_ROOT, "Videos"),
};

const PRUNE = process.argv.includes("--prune");

/**
 * @typedef {object} FileIndexStats
 * @property {number} scanned Regular files inspected after exclusions.
 * @property {number} added Files inserted into the database.
 * @property {number} updated Existing files with changed size or modification time.
 * @property {number} unchanged Existing files with unchanged size and modification time.
 * @property {number} removed Stale records deleted when pruning is enabled.
 * @property {number} ignored Files skipped by name or extension.
 * @property {number} errors File or directory operations that failed.
 */

// -----------------------------------------------------------------------------
// Files we do not want indexed
// -----------------------------------------------------------------------------

const IGNORED_NAMES = new Set([
    ".DS_Store",
    "Thumbs.db",
]);

const IGNORED_EXTENSIONS = new Set([
    ".tmp",
    ".part",
    ".crdownload",
]);

// -----------------------------------------------------------------------------
// Prepared SQL statements
// -----------------------------------------------------------------------------

const findFile = db.prepare(`
    SELECT
        id,
        size,
        modified_at
    FROM files
    WHERE path = ?
`);

const insertFile = db.prepare(`
    INSERT INTO files (
        path,
        relative_path,
        filename,
        category,
        extension,
        size,
        modified_at,
        indexed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateFile = db.prepare(`
    UPDATE files
    SET
        relative_path = ?,
        filename = ?,
        category = ?,
        extension = ?,
        size = ?,
        modified_at = ?,
        indexed_at = ?
    WHERE path = ?
`);

const getFilesByCategory = db.prepare(`
    SELECT
        id,
        path
    FROM files
    WHERE category = ?
`);

const deleteFileById = db.prepare(`
    DELETE FROM files
    WHERE id = ?
`);

// -----------------------------------------------------------------------------
// Statistics
// -----------------------------------------------------------------------------

/** @returns {FileIndexStats} Zeroed counters for one indexing run. */
function createStats() {
    return {
        scanned: 0,
        added: 0,
        updated: 0,
        unchanged: 0,
        removed: 0,
        ignored: 0,
        errors: 0,
    };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function normalizePath(filePath) {
    return path.resolve(filePath);
}

function getExtension(filename) {
    const extension = path.extname(filename).toLowerCase();

    return extension || null;
}

/**
 * Exclude OS metadata and incomplete downloads from all archive categories.
 * @param {string} filePath Path whose basename and extension are checked.
 * @returns {boolean} Whether the file is excluded.
 */
function shouldIgnore(filePath) {
    const filename = path.basename(filePath);

    if (IGNORED_NAMES.has(filename)) {
        return true;
    }

    const extension = path.extname(filename).toLowerCase();

    return IGNORED_EXTENSIONS.has(extension);
}

// -----------------------------------------------------------------------------
// Index a single file
// -----------------------------------------------------------------------------

/**
 * Insert or refresh one file row; unchanged size and mtime leave it untouched.
 * Errors are logged and counted instead of propagating.
 * @param {string} filePath Path to the archive file.
 * @param {string} category Archive category.
 * @param {string} categoryRoot Root used for the stored relative path.
 * @param {FileIndexStats} stats Counters updated in place.
 * @returns {void}
 */
function indexFile(
    filePath,
    category,
    categoryRoot,
    stats
) {
    try {
        if (shouldIgnore(filePath)) {
            stats.ignored++;
            return;
        }

        const fileStats = fs.statSync(filePath);

        if (!fileStats.isFile()) {
            return;
        }

        stats.scanned++;

        const absolutePath = normalizePath(filePath);

        const filename = path.basename(absolutePath);

        /*
         * Example:
         *
         * absolute:
         * /archive/Music/flac/Pink Floyd/The Wall/song.flac
         *
         * relative:
         * flac/Pink Floyd/The Wall/song.flac
         */
        const relativePath = path.relative(
            categoryRoot,
            absolutePath
        );

        const extension = getExtension(filename);

        const size = fileStats.size;

        /*
         * Integer milliseconds are easier to compare than
         * floating-point timestamps.
         */
        const modifiedAt = Math.trunc(
            fileStats.mtimeMs
        );

        const existing = findFile.get(
            absolutePath
        );

        // ---------------------------------------------------------------------
        // New file
        // ---------------------------------------------------------------------

        if (!existing) {
            insertFile.run(
                absolutePath,
                relativePath,
                filename,
                category,
                extension,
                size,
                modifiedAt,
                Date.now()
            );

            stats.added++;

            console.log(
                `+ ${category}: ${relativePath}`
            );

            return;
        }

        // ---------------------------------------------------------------------
        // Existing file
        // ---------------------------------------------------------------------

        const changed =
            existing.size !== size ||
            existing.modified_at !== modifiedAt;

        if (!changed) {
            stats.unchanged++;
            return;
        }

        // ---------------------------------------------------------------------
        // Existing file changed
        // ---------------------------------------------------------------------

        updateFile.run(
            relativePath,
            filename,
            category,
            extension,
            size,
            modifiedAt,
            Date.now(),
            absolutePath
        );

        stats.updated++;

        console.log(
            `~ ${category}: ${relativePath}`
        );
    } catch (error) {
        stats.errors++;

        console.error(
            `! Failed to index: ${filePath}`
        );

        console.error(
            `  ${error.message}`
        );
    }
}

// -----------------------------------------------------------------------------
// Recursively walk a directory
// -----------------------------------------------------------------------------

/**
 * Scan regular files and file symlinks without following directory symlinks.
 * A failed directory read marks the scan incomplete to prevent unsafe pruning.
 * @param {string} directory Directory being scanned.
 * @param {string} category Archive category.
 * @param {string} categoryRoot Root used for relative paths.
 * @param {Set<string>} seenPaths Paths encountered, including ignored files.
 * @param {FileIndexStats} stats Counters updated in place.
 * @param {{complete: boolean}} scanState Completion flag updated in place.
 * @returns {void}
 */
function walkDirectory(
    directory,
    category,
    categoryRoot,
    seenPaths,
    stats,
    scanState
) {
    let entries;

    try {
        entries = fs.readdirSync(
            directory,
            {
                withFileTypes: true,
            }
        );
    } catch (error) {
        stats.errors++;

        /*
         * This matters for --prune.
         *
         * If part of a directory could not be read, we should
         * NOT assume that files missing from seenPaths were
         * actually deleted.
         */
        scanState.complete = false;

        console.error(
            `! Could not read directory: ${directory}`
        );

        console.error(
            `  ${error.message}`
        );

        return;
    }

    for (const entry of entries) {
        const fullPath = path.join(
            directory,
            entry.name
        );

        try {
            // -----------------------------------------------------------------
            // Directory
            // -----------------------------------------------------------------

            if (entry.isDirectory()) {
                walkDirectory(
                    fullPath,
                    category,
                    categoryRoot,
                    seenPaths,
                    stats,
                    scanState
                );

                continue;
            }

            // -----------------------------------------------------------------
            // Regular file
            // -----------------------------------------------------------------

            if (entry.isFile()) {
                const absolutePath =
                    normalizePath(fullPath);

                seenPaths.add(
                    absolutePath
                );

                indexFile(
                    absolutePath,
                    category,
                    categoryRoot,
                    stats
                );

                continue;
            }

            // -----------------------------------------------------------------
            // Symbolic link
            // -----------------------------------------------------------------

            if (entry.isSymbolicLink()) {
                const linkedStats =
                    fs.statSync(fullPath);

                /*
                 * Follow symbolic links only when they point
                 * directly to a file.
                 *
                 * We intentionally do not recursively follow
                 * symlinked directories to avoid directory loops.
                 */
                if (linkedStats.isFile()) {
                    const absolutePath =
                        normalizePath(fullPath);

                    seenPaths.add(
                        absolutePath
                    );

                    indexFile(
                        absolutePath,
                        category,
                        categoryRoot,
                        stats
                    );
                }
            }
        } catch (error) {
            stats.errors++;
            scanState.complete = false;

            console.error(
                `! Error scanning: ${fullPath}`
            );

            console.error(
                `  ${error.message}`
            );
        }
    }
}

// -----------------------------------------------------------------------------
// Remove stale database records
// -----------------------------------------------------------------------------

/**
 * Delete category rows absent from a completed scan in one transaction.
 * @param {string} category Archive category to prune.
 * @param {Set<string>} seenPaths Paths found during the scan.
 * @param {FileIndexStats} stats Removal counter updated in place.
 * @returns {void}
 */
function pruneMissingFiles(
    category,
    seenPaths,
    stats
) {
    const indexedFiles =
        getFilesByCategory.all(category);

    const removeStaleFiles = db.transaction(
        (rows) => {
            for (const row of rows) {
                if (
                    !seenPaths.has(row.path)
                ) {
                    deleteFileById.run(
                        row.id
                    );

                    stats.removed++;

                    console.log(
                        `- ${category}: ${row.path}`
                    );
                }
            }
        }
    );

    removeStaleFiles(indexedFiles);
}

// -----------------------------------------------------------------------------
// Scan one archive category
// -----------------------------------------------------------------------------

/**
 * Scan one archive directory and optionally prune after a complete scan.
 * Missing or unreadable roots increment errors without deleting records.
 * @param {string} category Archive category.
 * @param {string} directory Category root on disk.
 * @param {FileIndexStats} stats Counters updated in place.
 * @returns {void}
 */
function scanCategory(
    category,
    directory,
    stats
) {
    console.log(
        `\nScanning ${category}`
    );

    console.log(
        `  ${directory}`
    );

    // -------------------------------------------------------------------------
    // Safety: archive directory missing
    // -------------------------------------------------------------------------

    if (!fs.existsSync(directory)) {
        stats.errors++;

        console.warn(
            `! Archive directory does not exist.`
        );

        console.warn(
            `  Skipping: ${directory}`
        );

        /*
         * Do not prune anything.
         *
         * The archive drive may simply be unmounted.
         */
        return;
    }

    let rootStats;

    try {
        rootStats = fs.statSync(
            directory
        );
    } catch (error) {
        stats.errors++;

        console.error(
            `! Could not inspect: ${directory}`
        );

        console.error(
            `  ${error.message}`
        );

        return;
    }

    if (!rootStats.isDirectory()) {
        stats.errors++;

        console.warn(
            `! Expected directory: ${directory}`
        );

        return;
    }

    // -------------------------------------------------------------------------
    // Scan
    // -------------------------------------------------------------------------

    const seenPaths = new Set();

    const scanState = {
        complete: true,
    };

    walkDirectory(
        directory,
        category,
        directory,
        seenPaths,
        stats,
        scanState
    );

    // -------------------------------------------------------------------------
    // Optional pruning
    // -------------------------------------------------------------------------

    if (!PRUNE) {
        return;
    }

    /*
     * Never prune if any portion of this category could not
     * be scanned successfully.
     *
     * This prevents unreadable directories or failed mounts
     * from causing valid DB entries to be deleted.
     */
    if (!scanState.complete) {
        console.warn(
            `! Skipping prune for ${category}`
        );

        console.warn(
            "  Scan was incomplete."
        );

        return;
    }

    pruneMissingFiles(
        category,
        seenPaths,
        stats
    );
}

// -----------------------------------------------------------------------------
// Main index operation
// -----------------------------------------------------------------------------

/**
 * Index configured archive categories and report aggregate file counts.
 * @returns {FileIndexStats} Counts for this run.
 */
function runIndexer() {
    const stats = createStats();

    const startTime = Date.now();

    console.log(
        "Archive File Indexer"
    );

    console.log(
        "=============================="
    );

    console.log(
        `Archive root: ${ARCHIVE_ROOT}`
    );

    console.log(
        `Prune:        ${
            PRUNE ? "enabled" : "disabled"
        }`
    );

    for (
        const [category, directory]
        of Object.entries(
            ARCHIVE_DIRECTORIES
        )
    ) {
        scanCategory(
            category,
            directory,
            stats
        );
    }

    const elapsedSeconds = (
        (Date.now() - startTime) / 1000
    ).toFixed(2);

    console.log(
        "\n=============================="
    );

    console.log(
        "Index complete"
    );

    console.log(
        "=============================="
    );

    console.log(
        `Scanned:   ${stats.scanned}`
    );

    console.log(
        `Added:     ${stats.added}`
    );

    console.log(
        `Updated:   ${stats.updated}`
    );

    console.log(
        `Unchanged: ${stats.unchanged}`
    );

    console.log(
        `Removed:   ${stats.removed}`
    );

    console.log(
        `Ignored:   ${stats.ignored}`
    );

    console.log(
        `Errors:    ${stats.errors}`
    );

    console.log(
        `Time:      ${elapsedSeconds}s`
    );

    if (!PRUNE) {
        console.log(
            "\nStale database entries were not removed."
        );

        console.log(
            "Run with --prune to synchronize deletions."
        );
    }

    return stats;
}

// -----------------------------------------------------------------------------
// Run directly from command line
// -----------------------------------------------------------------------------

if (require.main === module) {
    try {
        const stats = runIndexer();
        if (stats.scanned === 0 && stats.errors > 0) {
            console.error("No archive files were scanned. Check ARCHIVE_ROOT; the index was not updated.");
            process.exitCode = 1;
        }
    } catch (error) {
        console.error(
            "\nIndexer failed:"
        );

        console.error(error);

        process.exitCode = 1;
    }
}

// -----------------------------------------------------------------------------
// Exports
//
// Exporting these functions will make automated testing easier later.
// -----------------------------------------------------------------------------

module.exports = {
    runIndexer,
    scanCategory,
    indexFile,
};
