const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { projectRoot, createFixture, closeFixture, runIndexer, writeMedia } =
    require("../test-support/fixture");

const script = "src/indexers/fileIndexer.js";

describe("file indexer", () => {
    it("scans recursively, ignores temporary files, and updates changed rows without changing IDs", () => {
        const fixture = createFixture();
        try {
            const songPath = writeMedia(fixture, "music", "Artist/Album/Song.MP3", "first");
            writeMedia(fixture, "games", "Wii/Game.iso", "game");
            writeMedia(fixture, "pictures", "photo.JPG", "photo");
            writeMedia(fixture, "videos", "movie.mp4", "movie");
            for (const name of [".DS_Store", "Thumbs.db", "loading.tmp", "loading.PART", "loading.crdownload"]) {
                writeMedia(fixture, "music", "Artist/Album/" + name, "ignored");
            }

            const first = runIndexer(fixture, script);
            assert.equal(first.status, 0, first.stderr);
            assert.match(first.stdout, /Added:\s+4/);
            const rows = fixture.db.prepare(
                "SELECT id, relative_path, category, extension, size, modified_at, indexed_at FROM files ORDER BY category"
            ).all();
            assert.equal(rows.length, 4);
            const song = rows.find((row) => row.category === "music");
            assert.equal(song.relative_path, path.join("Artist", "Album", "Song.MP3"));
            assert.equal(song.extension, ".mp3");
            assert.equal(song.size, 5);

            const unchanged = runIndexer(fixture, script);
            assert.equal(unchanged.status, 0, unchanged.stderr);
            assert.match(unchanged.stdout, /Unchanged:\s+4/);
            assert.deepEqual(fixture.db.prepare("SELECT * FROM files WHERE id = ?").get(song.id).indexed_at,
                song.indexed_at);

            fs.writeFileSync(songPath, "changed content");
            // Fix mtime explicitly so this test does not depend on filesystem timestamp resolution.
            fs.utimesSync(songPath, new Date(20000), new Date(20000));
            const changed = runIndexer(fixture, script);
            assert.equal(changed.status, 0, changed.stderr);
            assert.match(changed.stdout, /Updated:\s+1/);
            const updated = fixture.db.prepare("SELECT * FROM files WHERE path = ?").get(songPath);
            assert.equal(updated.id, song.id);
            assert.equal(updated.size, 15);
            assert.equal(updated.modified_at, 20000);
            assert.ok(updated.indexed_at > song.indexed_at);
        } finally {
            closeFixture(fixture);
        }
    });

    it("retains stale rows by default and only prunes categories that can be scanned", () => {
        const fixture = createFixture();
        try {
            const gamePath = writeMedia(fixture, "games", "Wii/Old.iso", "old");
            writeMedia(fixture, "music", "Artist/Album/Keep.mp3", "keep");
            assert.equal(runIndexer(fixture, script).status, 0);
            const gameId = fixture.db.prepare("SELECT id FROM files WHERE path = ?").get(gamePath).id;

            fs.unlinkSync(gamePath);
            assert.equal(runIndexer(fixture, script).status, 0);
            assert.equal(fixture.db.prepare("SELECT id FROM files WHERE path = ?").get(gamePath).id, gameId);

            // An absent category can mean an unmounted archive drive; pruning must leave its rows alone.
            fs.rmdirSync(path.dirname(gamePath));
            fs.rmdirSync(path.join(fixture.archiveRoot, "Games"));
            const missingCategory = runIndexer(fixture, script, ["--prune"]);
            assert.equal(missingCategory.status, 0, missingCategory.stderr);
            assert.equal(fixture.db.prepare("SELECT id FROM files WHERE path = ?").get(gamePath).id, gameId);

            fs.mkdirSync(path.join(fixture.archiveRoot, "Games"));
            const pruned = runIndexer(fixture, script, ["--prune"]);
            assert.equal(pruned.status, 0, pruned.stderr);
            assert.match(pruned.stdout, /Removed:\s+1/);
            assert.equal(fixture.db.prepare("SELECT id FROM files WHERE path = ?").get(gamePath), undefined);
        } finally {
            closeFixture(fixture);
        }
    });

    it("does not prune a category after a nested directory read error", () => {
        const fixture = createFixture();
        try {
            writeMedia(fixture, "music", "Unreadable/StillThere.mp3", "present");
            const stalePath = writeMedia(fixture, "music", "Stale.mp3", "stale");
            writeMedia(fixture, "videos", "Keep.mp4", "video");
            assert.equal(runIndexer(fixture, script).status, 0);
            fs.unlinkSync(stalePath);

            // Inject a read error in the child process so this case is reliable
            // even when tests run with permissions that bypass chmod restrictions.
            const program = `
                const fs = require("node:fs");
                const path = require("node:path");
                const original = fs.readdirSync;
                fs.readdirSync = function (directory, ...args) {
                    if (String(directory).endsWith(path.join("Music", "Unreadable"))) {
                        const error = new Error("simulated read failure");
                        error.code = "EACCES";
                        throw error;
                    }
                    return original.call(fs, directory, ...args);
                };
                process.argv.push("--prune");
                require("./src/indexers/fileIndexer").runIndexer();
            `;
            const incomplete = spawnSync(process.execPath, ["-e", program], {
                cwd: projectRoot,
                env: { ...process.env, ARCHIVE_ROOT: fixture.archiveRoot, ARCHIVE_DB: fixture.dbPath },
                encoding: "utf8",
            });
            assert.equal(incomplete.status, 0, incomplete.stderr);
            assert.match(incomplete.stderr, /Skipping prune for music/);
            assert.ok(fixture.db.prepare("SELECT id FROM files WHERE path = ?").get(stalePath));

            assert.equal(runIndexer(fixture, script, ["--prune"]).status, 0);
            assert.equal(fixture.db.prepare("SELECT id FROM files WHERE path = ?").get(stalePath), undefined);
        } finally {
            closeFixture(fixture);
        }
    });

    it("indexes file links without descending through directory links", () => {
        const fixture = createFixture();
        try {
            writeMedia(fixture, "music", "Artist/Album/Target.mp3", "target");
            // Simulate Dirent/stat results because creating symlinks is restricted
            // on some Windows hosts; the indexer's traversal still runs normally.
            const program = `
                const fs = require("node:fs");
                const path = require("node:path");
                const root = path.join(process.env.ARCHIVE_ROOT, "Music");
                const target = path.join(root, "Artist", "Album", "Target.mp3");
                const fileLink = path.join(root, "Linked.mp3");
                const dirLink = path.join(root, "Loop");
                const read = fs.readdirSync;
                const stat = fs.statSync;
                fs.readdirSync = function (directory, ...args) {
                    const entries = read.call(fs, directory, ...args);
                    if (directory === root) {
                        for (const name of ["Linked.mp3", "Loop"]) {
                            entries.push({ name, isDirectory: () => false,
                                isFile: () => false, isSymbolicLink: () => true });
                        }
                    }
                    return entries;
                };
                fs.statSync = function (file, ...args) {
                    if (file === fileLink) return stat.call(fs, target, ...args);
                    if (file === dirLink) return stat.call(fs, path.dirname(target), ...args);
                    return stat.call(fs, file, ...args);
                };
                require("./src/indexers/fileIndexer").runIndexer();
            `;
            const result = spawnSync(process.execPath, ["-e", program], {
                cwd: projectRoot,
                env: { ...process.env, ARCHIVE_ROOT: fixture.archiveRoot, ARCHIVE_DB: fixture.dbPath },
                encoding: "utf8",
            });
            assert.equal(result.status, 0, result.stderr);
            const names = fixture.db.prepare("SELECT filename FROM files ORDER BY filename").all()
                .map((row) => row.filename);
            assert.deepEqual(names, ["Linked.mp3", "Target.mp3"]);
        } finally {
            closeFixture(fixture);
        }
    });
});
