const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function runIndexer(script, env) {
    const result = spawnSync(process.execPath, [path.join(projectRoot, script)], {
        cwd: projectRoot,
        env,
        encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
}

test("indexes console files and matching local covers without treating support files as games", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "home-archive-game-index-"));
    const archiveRoot = path.join(tempRoot, "archive");
    const dbPath = path.join(tempRoot, "archive.db");
    const nesRoot = path.join(archiveRoot, "Games", "Nintendo Entertainment System");
    const n64Root = path.join(archiveRoot, "Games", "Nintendo 64");
    const ps2Root = path.join(archiveRoot, "Games", "PlayStation 2");

    try {
        for (const category of ["Music", "Games", "Pictures", "Videos"]) {
            fs.mkdirSync(path.join(archiveRoot, category), { recursive: true });
        }
        for (const directory of [nesRoot, n64Root, ps2Root, path.join(nesRoot, "BIOS")]) {
            fs.mkdirSync(directory, { recursive: true });
        }
        for (const file of [
            path.join(nesRoot, "Super_Mario_Bros.nes"),
            path.join(nesRoot, "Super_Mario_Bros.PNG"),
            path.join(nesRoot, "Unlisted.rom"),
            path.join(nesRoot, "Extras.zip"),
            path.join(nesRoot, "BIOS", "bios.nes"),
            path.join(n64Root, "Star Fox.z64"),
            path.join(ps2Root, "Shadow Realm.iso"),
            path.join(ps2Root, "Track.bin"),
            path.join(ps2Root, "Track.cue"),
        ]) {
            fs.writeFileSync(file, "fixture");
        }

        const env = {
            ...process.env,
            ARCHIVE_ROOT: archiveRoot,
            ARCHIVE_DB: dbPath,
            GAME_EXTRA_EXTENSIONS: "",
            IGDB_CLIENT_ID: "",
            IGDB_CLIENT_SECRET: "",
        };
        runIndexer("src/indexers/fileIndexer.js", env);
        runIndexer("src/indexers/gameIndexer.js", env);

        const Database = require("better-sqlite3");
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        try {
            const games = db.prepare(
                "SELECT g.source_key, g.title, g.platform, artwork.filename AS cover " +
                "FROM games g LEFT JOIN files artwork ON artwork.id = g.artwork_file_id " +
                "ORDER BY g.source_key"
            ).all();
            assert.deepEqual(games, [
                {
                    source_key: "Nintendo 64/Star Fox.z64",
                    title: "Star Fox",
                    platform: "Nintendo 64",
                    cover: null,
                },
                {
                    source_key: "Nintendo Entertainment System/Super_Mario_Bros.nes",
                    title: "Super Mario Bros",
                    platform: "Nintendo Entertainment System",
                    cover: "Super_Mario_Bros.PNG",
                },
                {
                    source_key: "PlayStation 2/Shadow Realm.iso",
                    title: "Shadow Realm",
                    platform: "PlayStation 2",
                    cover: null,
                },
            ]);
        } finally {
            db.close();
        }

        runIndexer("src/indexers/gameIndexer.js", {
            ...env,
            GAME_EXTRA_EXTENSIONS: "ROM",
        });
        const dbWithExtra = new Database(dbPath, { readonly: true, fileMustExist: true });
        try {
            const extra = dbWithExtra.prepare(
                "SELECT source_key FROM games WHERE source_key = ?"
            ).get("Nintendo Entertainment System/Unlisted.rom");
            assert.equal(extra?.source_key, "Nintendo Entertainment System/Unlisted.rom");
        } finally {
            dbWithExtra.close();
        }
    } finally {
        assert.equal(path.dirname(tempRoot), os.tmpdir());
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("matches a full console folder name to the same IGDB platform name", () => {
    const { matchGame } = require("../src/indexers/igdb");
    const result = {
        name: "Super Mario Bros.",
        platforms: [{ name: "Nintendo Entertainment System" }],
    };
    assert.equal(matchGame([result], "Super Mario Bros.", "Nintendo Entertainment System"), result);
    assert.equal(matchGame([result], "Super Mario Bros.", "Nintendo 64"), null);
});
