const db = require("./database");

const SEARCH_TABLES = [
    { table: "files", columns: ["filename", "relative_path"] },
    { table: "games", columns: ["title", "platform"] },
    { table: "artists", columns: ["name"] },
    { table: "albums", columns: ["title"] },
    { table: "tracks", columns: ["title"] },
];

function initializeSearchIndexes() {
    // Keep creation, triggers, and backfill atomic. A startup interrupted
    // during migration must not leave an empty index marked as initialized.
    db.transaction(() => {
        for (const { table, columns } of SEARCH_TABLES) {
            const index = table + "_fts";
            const existed = db.prepare(
                "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?"
            ).get(index);
            const values = columns.join(", ");
            const oldValues = columns.map((column) => "old." + column).join(", ");
            const newValues = columns.map((column) => "new." + column).join(", ");

            // External-content indexes avoid storing a second copy of display data.
            // Triggers keep them in sync when indexers insert, update, or prune rows.
            db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS ${index} USING fts5(
                    ${values}, content='${table}', content_rowid='id', tokenize='trigram'
                );
                CREATE TRIGGER IF NOT EXISTS ${index}_insert AFTER INSERT ON ${table} BEGIN
                    INSERT INTO ${index}(rowid, ${values}) VALUES (new.id, ${newValues});
                END;
                CREATE TRIGGER IF NOT EXISTS ${index}_delete AFTER DELETE ON ${table} BEGIN
                    INSERT INTO ${index}(${index}, rowid, ${values})
                    VALUES ('delete', old.id, ${oldValues});
                END;
                CREATE TRIGGER IF NOT EXISTS ${index}_update AFTER UPDATE ON ${table} BEGIN
                    INSERT INTO ${index}(${index}, rowid, ${values})
                    VALUES ('delete', old.id, ${oldValues});
                    INSERT INTO ${index}(rowid, ${values}) VALUES (new.id, ${newValues});
                END;
            `);

            // Existing databases predate these triggers, so backfill only when an
            // FTS table is first created. Rebuilding on every startup would be costly.
            if (!existed) {
                db.prepare(`INSERT INTO ${index}(${index}) VALUES ('rebuild')`).run();
            }
        }
    })();
}

module.exports = { initializeSearchIndexes };
