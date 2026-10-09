const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");
const Database = require("better-sqlite3");
const { projectRoot, createFixture, closeFixture, addFile } = require("../test-support/fixture");

describe("SQLite schema", () => {
    it("adds game bundle columns to an existing games table", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "home-archive-schema-migration-"));
        const dbPath = path.join(root, "archive.db");
        try {
            const old = new Database(dbPath);
            old.exec("CREATE TABLE games (id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL UNIQUE, " +
                "source_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, platform TEXT NOT NULL, " +
                "release_year INTEGER, genre TEXT, artwork_file_id INTEGER, igdb_id INTEGER, " +
                "igdb_cover_image_id TEXT, summary TEXT, igdb_url TEXT)");
            old.close();
            const migrated = spawnSync(process.execPath, ["-e", "require('./src/db/schema')"], {
                cwd: projectRoot, env: { ...process.env, ARCHIVE_DB: dbPath }, encoding: "utf8",
            });
            assert.equal(migrated.status, 0, migrated.stderr);
            const db = new Database(dbPath);
            try {
                const columns = db.prepare("PRAGMA table_info(games)").all().map((row) => row.name);
                assert.ok(columns.includes("expected_file_count"));
                assert.ok(columns.includes("expected_disc_count"));
                assert.ok(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'game_files'").get());
                assert.ok(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'books'").get());
            } finally {
                db.close();
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("initializes repeatedly and enforces unique keys and foreign keys", () => {
        const fixture = createFixture();
        try {
            const repeated = spawnSync(process.execPath, ["-e", "require('./src/db/schema')"], {
                cwd: projectRoot,
                env: { ...process.env, ARCHIVE_DB: fixture.dbPath },
                encoding: "utf8",
            });
            assert.equal(repeated.status, 0, repeated.stderr);
            fixture.db.pragma("foreign_keys = ON");
            assert.equal(fixture.db.pragma("foreign_keys", { simple: true }), 1);
            const fileId = addFile(fixture, "music", "Artist/Album/Song.mp3", "song");
            assert.throws(() => fixture.db.prepare(
                "INSERT INTO files (path, relative_path, filename, category, size, modified_at, indexed_at) " +
                "SELECT path, relative_path, filename, category, size, modified_at, indexed_at FROM files WHERE id = ?"
            ).run(fileId), /UNIQUE constraint failed/);
            assert.throws(() => fixture.db.prepare(
                "INSERT INTO tracks (file_id, title) VALUES (?, ?)"
            ).run(fileId + 100, "orphan"), /FOREIGN KEY constraint failed/);
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM tracks").get().count, 0);
        } finally {
            closeFixture(fixture);
        }
    });

    it("cascades deleted source files and clears optional artwork references", () => {
        const fixture = createFixture();
        try {
            fixture.db.pragma("foreign_keys = ON");
            const audioId = addFile(fixture, "music", "Artist/Album/Song.mp3", "song");
            const artId = addFile(fixture, "music", "Artist/Album/cover.jpg", "art");
            const gameId = addFile(fixture, "games", "Wii/Game.iso", "game");
            const albumId = Number(fixture.db.prepare(
                "INSERT INTO albums (source_key, title, artwork_file_id) VALUES (?, ?, ?)"
            ).run("Artist/Album", "Album", artId).lastInsertRowid);
            fixture.db.prepare("INSERT INTO tracks (file_id, album_id, title) VALUES (?, ?, ?)")
                .run(audioId, albumId, "Song");
            fixture.db.prepare(
                "INSERT INTO games (file_id, source_key, title, platform, artwork_file_id) VALUES (?, ?, ?, ?, ?)"
            ).run(gameId, "Wii/Game.iso", "Game", "Wii", artId);

            fixture.db.prepare("DELETE FROM files WHERE id = ?").run(artId);
            assert.equal(fixture.db.prepare("SELECT artwork_file_id FROM albums WHERE id = ?")
                .get(albumId).artwork_file_id, null);
            assert.equal(fixture.db.prepare("SELECT artwork_file_id FROM games WHERE file_id = ?")
                .get(gameId).artwork_file_id, null);

            fixture.db.prepare("DELETE FROM files WHERE id = ?").run(audioId);
            fixture.db.prepare("DELETE FROM files WHERE id = ?").run(gameId);
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM tracks").get().count, 0);
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM games").get().count, 0);
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM albums").get().count, 1);
        } finally {
            closeFixture(fixture);
        }
    });

    it("enforces book membership keys and cascades book metadata without restricting shared ISBNs", () => {
        const fixture = createFixture();
        try {
            fixture.db.pragma("foreign_keys = ON");
            const epub = addFile(fixture, "books", "Edition.epub", "epub");
            const txt = addFile(fixture, "books", "Edition.txt", "txt");
            const insert = fixture.db.prepare("INSERT INTO books (source_key, title, created_at, indexed_at) VALUES (?, ?, 1000, 1000)");
            const first = Number(insert.run("Edition", "Edition").lastInsertRowid);
            const second = Number(insert.run("Other", "Other").lastInsertRowid);
            assert.throws(() => insert.run("Edition", "Duplicate"), /UNIQUE/);
            const link = fixture.db.prepare("INSERT INTO book_files VALUES (?, ?, ?)");
            link.run(first, epub, "epub");
            link.run(first, txt, "txt");
            assert.throws(() => link.run(second, epub, "epub"), /UNIQUE/);
            assert.throws(() => link.run(second, epub + 1000, "epub"), /FOREIGN KEY/);
            const identifier = fixture.db.prepare("INSERT INTO book_identifiers VALUES (?, 'isbn13', '9780306406157', 'epub')");
            identifier.run(first);
            identifier.run(second);
            fixture.db.prepare("INSERT INTO book_contributors (book_id, name, role, position) VALUES (?, 'Writer', 'aut', 0)").run(first);
            fixture.db.prepare("INSERT INTO book_subjects VALUES (?, 'Fiction', '')").run(first);
            fixture.db.prepare("INSERT INTO book_languages VALUES (?, 'en')").run(first);
            fixture.db.prepare("INSERT INTO book_artwork VALUES (?, 'image/png', ?, 'checksum')").run(first, Buffer.from("cover"));
            fixture.db.prepare("INSERT INTO book_index_state VALUES (?, 'fingerprint', 1, 'ok', 1000, 1000, NULL)").run(first);
            fixture.db.prepare("DELETE FROM files WHERE id = ?").run(epub);
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM book_files WHERE book_id = ?").get(first).count, 1);
            assert.ok(fixture.db.prepare("SELECT id FROM books WHERE id = ?").get(first));
            fixture.db.prepare("DELETE FROM books WHERE id = ?").run(first);
            for (const table of ["book_files", "book_identifiers", "book_contributors", "book_subjects", "book_languages", "book_artwork", "book_index_state"]) {
                assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM " + table + " WHERE book_id = ?").get(first).count, 0, table);
            }
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM book_identifiers").get().count, 1);
            assert.deepEqual(fixture.db.prepare("SELECT rowid FROM book_contributors_fts WHERE book_contributors_fts MATCH '\"Writer\"'").all(), []);
        } finally { closeFixture(fixture); }
    });

    it("cascades album and artist junction rows while retaining tracks", () => {
        const fixture = createFixture();
        try {
            fixture.db.pragma("foreign_keys = ON");
            const fileId = addFile(fixture, "music", "Artist/Album/Song.mp3", "song");
            const artistId = Number(fixture.db.prepare("INSERT INTO artists (name) VALUES (?)")
                .run("Artist").lastInsertRowid);
            const albumId = Number(fixture.db.prepare("INSERT INTO albums (source_key, title) VALUES (?, ?)")
                .run("Artist/Album", "Album").lastInsertRowid);
            const trackId = Number(fixture.db.prepare(
                "INSERT INTO tracks (file_id, album_id, title) VALUES (?, ?, ?)"
            ).run(fileId, albumId, "Song").lastInsertRowid);
            fixture.db.prepare("INSERT INTO album_artists VALUES (?, ?)").run(albumId, artistId);
            fixture.db.prepare("INSERT INTO track_artists VALUES (?, ?)").run(trackId, artistId);
            fixture.db.prepare("INSERT INTO album_artwork VALUES (?, ?, ?)")
                .run(albumId, "image/png", Buffer.from("image"));

            fixture.db.prepare("DELETE FROM albums WHERE id = ?").run(albumId);
            assert.equal(fixture.db.prepare("SELECT album_id FROM tracks WHERE id = ?")
                .get(trackId).album_id, null);
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM album_artwork").get().count, 0);
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM album_artists").get().count, 0);
            fixture.db.prepare("DELETE FROM artists WHERE id = ?").run(artistId);
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM track_artists").get().count, 0);
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM tracks").get().count, 1);
        } finally {
            closeFixture(fixture);
        }
    });
});
