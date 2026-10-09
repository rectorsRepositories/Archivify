const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { after, before, describe, it } = require("node:test");
const { projectRoot, createFixture, closeFixture, addFile, startApi, stopApi, getJson } =
    require("../test-support/fixture");

describe("search indexes", () => {
    let fixture;
    let api;
    let ids;

    before(async () => {
        fixture = createFixture();
        fixture.db.pragma("foreign_keys = ON");
        ids = {};
        ids.picture = addFile(fixture, "pictures", "Trip/Falcon.png", "image");
        const gameFile = addFile(fixture, "games", "Wii/Star Fox.iso", "game");
        const trackFile = addFile(fixture, "music", "Sunrise/Bright/01.mp3", "track");
        fixture.db.prepare(
            "INSERT INTO games (file_id, source_key, title, platform) VALUES (?, ?, ?, ?)"
        ).run(gameFile, "Wii/Star Fox.iso", "Star Fox", "Wii");
        ids.artist = Number(fixture.db.prepare("INSERT INTO artists (name) VALUES (?)")
            .run("Sunrise").lastInsertRowid);
        ids.album = Number(fixture.db.prepare("INSERT INTO albums (source_key, title) VALUES (?, ?)")
            .run("Sunrise/Bright", "Bright Album").lastInsertRowid);
        ids.track = Number(fixture.db.prepare(
            "INSERT INTO tracks (file_id, album_id, title) VALUES (?, ?, ?)"
        ).run(trackFile, ids.album, "First Track").lastInsertRowid);
        fixture.db.prepare("INSERT INTO album_artists VALUES (?, ?)").run(ids.album, ids.artist);
        fixture.db.prepare("INSERT INTO track_artists VALUES (?, ?)").run(ids.track, ids.artist);
        api = await startApi(fixture.dbPath);
    });
    after(async () => {
        if (api) await stopApi(api.child);
        if (fixture) closeFixture(fixture);
    });

    it("preserves substring search for indexed, short, and punctuation queries", async () => {
        for (const [endpoint, expected] of [
            ["/api/v1/files?q=Falcon", 1],
            ["/api/v1/files?q=Fa", 1],
            ["/api/v1/files?q=Falcon.png", 1],
            ["/api/v1/games?q=star", 1],
            ["/api/v1/games?q=star%20fox", 1],
            ["/api/v1/games?q=Wi", 1],
            ["/api/v1/music/artists?q=sunrise", 1],
            ["/api/v1/music/albums?q=sunrise", 1],
            ["/api/v1/music/tracks?q=sunrise", 1],
            ["/api/v1/music/albums?q=bright", 1],
            ["/api/v1/music/tracks?q=first", 1],
        ]) {
            const { response, body } = await getJson(api.baseUrl, endpoint);
            assert.equal(response.status, 200, endpoint);
            assert.equal(body.pagination.total, expected, endpoint);
        }
    });

    it("keeps FTS rows synchronized when indexed metadata changes or is deleted", async () => {
        fixture.db.prepare("UPDATE files SET filename = ?, relative_path = ? WHERE id = ?")
            .run("Heron.png", "Trip/Heron.png", ids.picture);
        fixture.db.prepare("UPDATE artists SET name = ? WHERE id = ?")
            .run("Moonrise", ids.artist);
        fixture.db.prepare("UPDATE games SET title = ?").run("Nova Fox");
        fixture.db.prepare("UPDATE albums SET title = ? WHERE id = ?")
            .run("Radiant Album", ids.album);
        fixture.db.prepare("UPDATE tracks SET title = ? WHERE id = ?")
            .run("Opening Track", ids.track);
        for (const [endpoint, expected] of [
            ["/api/v1/files?q=Falcon", 0],
            ["/api/v1/files?q=Heron", 1],
            ["/api/v1/music/artists?q=sunrise", 0],
            ["/api/v1/music/albums?q=sunrise", 0],
            ["/api/v1/music/tracks?q=sunrise", 0],
            ["/api/v1/music/albums?q=moonrise", 1],
            ["/api/v1/music/tracks?q=moonrise", 1],
            ["/api/v1/games?q=star", 0],
            ["/api/v1/games?q=nova", 1],
            ["/api/v1/music/albums?q=bright", 0],
            ["/api/v1/music/albums?q=radiant", 1],
            ["/api/v1/music/tracks?q=first", 0],
            ["/api/v1/music/tracks?q=opening", 1],
        ]) {
            const { body } = await getJson(api.baseUrl, endpoint);
            assert.equal(body.pagination.total, expected, endpoint);
        }
        fixture.db.prepare("DELETE FROM files WHERE id = ?").run(ids.picture);
        assert.equal((await getJson(api.baseUrl, "/api/v1/files?q=Heron"))
            .body.pagination.total, 0);
        assert.deepEqual(fixture.db.prepare(
            "SELECT rowid FROM files_fts WHERE files_fts MATCH ?"
        ).all('"Heron"'), []);
    });
});

it("backfills FTS when an existing database first gains the search index", () => {
    const fixture = createFixture();
    try {
        // Model an older database that has data but no FTS table or triggers.
        for (const suffix of ["insert", "delete", "update"]) {
            fixture.db.exec("DROP TRIGGER files_fts_" + suffix);
        }
        fixture.db.exec("DROP TABLE files_fts");
        const fileId = addFile(fixture, "pictures", "Trip/Legacy.png", "legacy");
        const upgrade = spawnSync(process.execPath, ["-e", "require('./src/db/schema')"], {
            cwd: projectRoot,
            env: { ...process.env, ARCHIVE_DB: fixture.dbPath },
            encoding: "utf8",
        });
        assert.equal(upgrade.status, 0, upgrade.stderr);
        assert.deepEqual(fixture.db.prepare(
            "SELECT rowid FROM files_fts WHERE files_fts MATCH ?"
        ).all('"Legacy"'), [{ rowid: fileId }]);
    } finally {
        closeFixture(fixture);
    }
});

it("backfills existing book and contributor metadata when their FTS indexes are added", () => {
    const fixture = createFixture();
    try {
        for (const table of ["books", "book_contributors"]) {
            for (const suffix of ["insert", "delete", "update"]) fixture.db.exec("DROP TRIGGER " + table + "_fts_" + suffix);
            fixture.db.exec("DROP TABLE " + table + "_fts");
        }
        const id = Number(fixture.db.prepare("INSERT INTO books (source_key, title, created_at, indexed_at) VALUES ('Legacy', 'Legacy Book', 1000, 1000)").run().lastInsertRowid);
        const contributorId = Number(fixture.db.prepare("INSERT INTO book_contributors (book_id, name, role, position) VALUES (?, 'Legacy Writer', 'aut', 0)").run(id).lastInsertRowid);
        const upgrade = spawnSync(process.execPath, ["-e", "require('./src/db/schema')"], {
            cwd: projectRoot, env: { ...process.env, ARCHIVE_DB: fixture.dbPath }, encoding: "utf8",
        });
        assert.equal(upgrade.status, 0, upgrade.stderr);
        assert.deepEqual(fixture.db.prepare("SELECT rowid FROM books_fts WHERE books_fts MATCH '\"Legacy\"'").all(), [{ rowid: id }]);
        assert.deepEqual(fixture.db.prepare("SELECT rowid FROM book_contributors_fts WHERE book_contributors_fts MATCH '\"Writer\"'").all(), [{ rowid: contributorId }]);
    } finally { closeFixture(fixture); }
});
