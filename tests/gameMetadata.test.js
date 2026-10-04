const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { createFixture, closeFixture, runIndexer, writeMedia } = require("../test-support/fixture");

describe("game metadata indexer", () => {
    it("applies sidecars, falls back from malformed JSON, and preserves IDs on rerun", () => {
        const fixture = createFixture();
        try {
            writeMedia(fixture, "games", "Wii/Legend (USA) (En,Fr).iso", "game");
            writeMedia(fixture, "games", "Wii/Legend (USA) (En,Fr).game.json", JSON.stringify({
                title: "Custom Legend", platform: "Nintendo Wii", release_year: 2008, genre: "Action",
            }));
            writeMedia(fixture, "games", "Wii/Legend (USA) (En,Fr).JPG", "cover");
            writeMedia(fixture, "games", "PS2/Bad.iso", "bad");
            writeMedia(fixture, "games", "PS2/Bad.game.json", "{not JSON");
            writeMedia(fixture, "games", "PS2/BIOS/boot.iso", "bios");
            writeMedia(fixture, "games", "PS2/Track.bin", "support");
            writeMedia(fixture, "games", "PS2/Extra.ROM", "extra");
            assert.equal(runIndexer(fixture, "src/indexers/fileIndexer.js").status, 0);

            const first = runIndexer(fixture, "src/indexers/gameIndexer.js");
            assert.equal(first.status, 0, first.stderr);
            assert.match(first.stderr, /Could not read game metadata/);
            const games = fixture.db.prepare(
                "SELECT g.id, g.source_key, g.title, g.platform, g.release_year, g.genre, f.filename AS cover " +
                "FROM games g LEFT JOIN files f ON f.id = g.artwork_file_id ORDER BY g.source_key"
            ).all();
            assert.deepEqual(games.map((game) => game.source_key), [
                "PS2/Bad.iso", "Wii/Legend (USA) (En,Fr).iso",
            ]);
            assert.deepEqual(games[0], {
                id: games[0].id, source_key: "PS2/Bad.iso", title: "Bad", platform: "PS2",
                release_year: null, genre: null, cover: null,
            });
            assert.deepEqual(games[1], {
                id: games[1].id, source_key: "Wii/Legend (USA) (En,Fr).iso",
                title: "Custom Legend", platform: "Nintendo Wii", release_year: 2008,
                genre: "Action", cover: "Legend (USA) (En,Fr).JPG",
            });

            const second = runIndexer(fixture, "src/indexers/gameIndexer.js");
            assert.equal(second.status, 0, second.stderr);
            assert.deepEqual(fixture.db.prepare("SELECT id, source_key FROM games ORDER BY source_key").all(),
                games.map(({ id, source_key }) => ({ id, source_key })));

            // Previously enriched metadata remains usable when credentials are not configured.
            fixture.db.prepare(
                "UPDATE games SET igdb_id = 5, igdb_cover_image_id = 'cover5', summary = 'Summary', " +
                "igdb_url = 'https://example.test/game' WHERE source_key = ?"
            ).run("PS2/Bad.iso");
            assert.equal(runIndexer(fixture, "src/indexers/gameIndexer.js").status, 0);
            assert.deepEqual(fixture.db.prepare(
                "SELECT igdb_id, igdb_cover_image_id, summary, igdb_url FROM games WHERE source_key = ?"
            ).get("PS2/Bad.iso"), {
                igdb_id: 5, igdb_cover_image_id: "cover5", summary: "Summary",
                igdb_url: "https://example.test/game",
            });
        } finally {
            closeFixture(fixture);
        }
    });

    it("validates extra extensions and only indexes configured formats", () => {
        const fixture = createFixture();
        try {
            writeMedia(fixture, "games", "Wii/Extra.ROM", "rom");
            assert.equal(runIndexer(fixture, "src/indexers/fileIndexer.js").status, 0);
            const invalid = runIndexer(fixture, "src/indexers/gameIndexer.js", [], {
                GAME_EXTRA_EXTENSIONS: "bad!",
            });
            assert.equal(invalid.status, 1);
            assert.match(invalid.stderr, /Invalid GAME_EXTRA_EXTENSIONS entry/);
            assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM games").get().count, 0);

            const configured = runIndexer(fixture, "src/indexers/gameIndexer.js", [], {
                GAME_EXTRA_EXTENSIONS: ".ROM",
            });
            assert.equal(configured.status, 0, configured.stderr);
            assert.deepEqual(fixture.db.prepare("SELECT source_key FROM games").all(), [
                { source_key: "Wii/Extra.ROM" },
            ]);
        } finally {
            closeFixture(fixture);
        }
    });

    it("cleans release tags while keeping meaningful qualifiers", () => {
        const fixture = createFixture();
        const originalDbPath = process.env.ARCHIVE_DB;
        try {
            process.env.ARCHIVE_DB = fixture.dbPath;
            const { gameTitleFromStem, parseGameFile } = require("../src/indexers/gameIndexer");
            assert.equal(gameTitleFromStem("Game (HD) (USA) (Rev 2)"), "Game (HD)");
            assert.equal(gameTitleFromStem("Legend of Zelda, The - Twilight Princess (USA)"),
                "The Legend of Zelda: Twilight Princess");
            assert.equal(parseGameFile({ id: 1, filename: "Game.iso", extension: ".iso",
                relative_path: "PS2\\BIOS\\Game.iso" }), null);
            assert.equal(parseGameFile({ id: 1, filename: "Game.bin", extension: ".bin",
                relative_path: "PS2/Game.bin" }), null);
        } finally {
            require("../src/db/database").close();
            if (originalDbPath === undefined) delete process.env.ARCHIVE_DB;
            else process.env.ARCHIVE_DB = originalDbPath;
            closeFixture(fixture);
        }
    });
});
