const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const Database = require("better-sqlite3");

const rowCount = Number(process.argv[2] || 50000);
if (!Number.isSafeInteger(rowCount) || rowCount < 1000 || rowCount > 1000000) {
    throw new Error("Row count must be an integer from 1000 to 1000000.");
}

// Use synthetic in-memory rows so benchmarking never reads or changes an archive.
const db = new Database(":memory:");
try {
    db.exec(`
        CREATE TABLE entries (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
        CREATE VIRTUAL TABLE entries_fts USING fts5(
            title, content='entries', content_rowid='id', tokenize='trigram'
        );
    `);
    const insert = db.prepare("INSERT INTO entries (title) VALUES (?)");
    db.transaction(() => {
        for (let index = 0; index < rowCount; index++) {
            insert.run(index % 199 === 0
                ? "Star Fox Collection " + index
                : "Archive Game Number " + index);
        }
    })();
    db.exec("INSERT INTO entries_fts(entries_fts) VALUES ('rebuild')");

    const scan = db.prepare(
        "SELECT COUNT(*) AS count FROM entries WHERE instr(lower(title), lower(?)) > 0"
    );
    const indexed = db.prepare(
        "SELECT COUNT(*) AS count FROM entries WHERE id IN " +
        "(SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?) " +
        "AND instr(lower(title), lower(?)) > 0"
    );
    const query = "star fox";
    const phrase = '"' + query + '"';
    assert.equal(scan.get(query).count, indexed.get(phrase, query).count);

    function elapsed(statement, args) {
        for (let index = 0; index < 5; index++) statement.get(...args);
        const start = performance.now();
        for (let index = 0; index < 30; index++) statement.get(...args);
        return (performance.now() - start) / 30;
    }

    const scanMs = elapsed(scan, [query]);
    const indexedMs = elapsed(indexed, [phrase, query]);
    console.log(`Rows: ${rowCount}; matches: ${scan.get(query).count}`);
    console.log(`Substring scan: ${scanMs.toFixed(3)} ms/query`);
    console.log(`FTS candidate + substring check: ${indexedMs.toFixed(3)} ms/query`);
} finally {
    db.close();
}
