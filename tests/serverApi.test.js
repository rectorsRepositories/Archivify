const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const Database = require("better-sqlite3");

const projectRoot = path.resolve(__dirname, "..");

// The database connection is created when server modules load. A child process
// lets each fixture choose ARCHIVE_DB before any server code is imported.
const serverProgram = `
    const { createServer } = require("./src/server");
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
        process.stdout.write("READY:" + server.address().port + "\\n");
    });
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;

function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "home-archive-api-"));
    const archiveRoot = path.join(root, "archive");
    const dbPath = path.join(root, "archive.db");
    for (const category of ["Music", "Games", "Pictures", "Videos"]) {
        fs.mkdirSync(path.join(archiveRoot, category), { recursive: true });
    }
    // Initialize the real schema against this temporary database, never the
    // developer's configured archive database.
    const result = spawnSync(process.execPath, ["-e", "require('./src/db/schema')"], {
        cwd: projectRoot,
        env: { ...process.env, ARCHIVE_DB: dbPath },
        encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return { root, archiveRoot, dbPath, db: new Database(dbPath) };
}

function addFile(fixture, category, relativePath, bytes, { missing = false } = {}) {
    const categoryRoot = {
        music: "Music", games: "Games", pictures: "Pictures", videos: "Videos",
    }[category];
    const fullPath = path.join(fixture.archiveRoot, categoryRoot, ...relativePath.split("/"));
    // A missing disk file with an indexed row models an archive that changed
    // since its last scan; delivery must report it as unavailable.
    if (!missing) {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, bytes);
    }
    const filename = path.basename(fullPath);
    const extension = path.extname(filename).toLowerCase() || null;
    const size = Buffer.byteLength(bytes);
    const row = fixture.db.prepare(
        "INSERT INTO files (path, relative_path, filename, category, extension, size, modified_at, indexed_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(fullPath, relativePath, filename, category, extension, size, 1000, 2000);
    return Number(row.lastInsertRowid);
}

function addGame(fixture, fileId, sourceKey, title, platform, year, genre, artworkFileId, coverId) {
    return Number(fixture.db.prepare(
        "INSERT INTO games (file_id, source_key, title, platform, release_year, genre, artwork_file_id, " +
        "igdb_cover_image_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(fileId, sourceKey, title, platform, year, genre, artworkFileId, coverId).lastInsertRowid);
}

function startApi(dbPath) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["-e", serverProgram], {
            cwd: projectRoot,
            env: { ...process.env, ARCHIVE_DB: dbPath,
                ARCHIVE_ROOT: path.join(path.dirname(dbPath), "archive") },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        let errorOutput = "";
        let settled = false;
        // Wait for listen(0) to choose a port before issuing HTTP requests.
        const timer = setTimeout(() => fail(new Error("API startup timed out: " + errorOutput)), 5000);
        function fail(error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.kill();
            reject(error);
        }
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => { errorOutput += chunk; });
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            output += chunk;
            const match = /READY:(\d+)\r?\n/.exec(output);
            if (!match || settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ child, baseUrl: "http://127.0.0.1:" + match[1] });
        });
        child.once("error", fail);
        child.once("exit", (code) => {
            fail(new Error("API exited before startup (" + code + "): " + errorOutput));
        });
    });
}

function stopApi(child) {
    return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("exit", resolve);
        child.kill();
    });
}

async function getJson(baseUrl, endpoint, options) {
    const response = await fetch(baseUrl + endpoint, options);
    return { response, body: await response.json() };
}

describe("server API with an empty index", () => {
    let fixture;
    let api;

    before(async () => {
        fixture = createFixture();
        api = await startApi(fixture.dbPath);
    });
    after(async () => {
        if (api) await stopApi(api.child);
        if (fixture) {
            fixture.db.close();
            fs.rmSync(fixture.root, { recursive: true, force: true });
        }
    });

    it("serves health and empty lists with the public response shape", async () => {
        const health = await getJson(api.baseUrl, "/api/v1/health");
        assert.equal(health.response.status, 200);
        assert.deepEqual(health.body, { status: "ok" });
        assert.match(health.response.headers.get("content-type"), /^application\/json/);
        assert.equal(health.response.headers.get("cache-control"), "no-store");
        assert.equal(health.response.headers.get("x-content-type-options"), "nosniff");

        for (const endpoint of ["/api/v1/files", "/api/v1/games"]) {
            const { response, body } = await getJson(api.baseUrl, endpoint);
            assert.equal(response.status, 200);
            assert.deepEqual(body, {
                data: [], pagination: { limit: 30, offset: 0, total: 0 },
            });
        }
        const summary = await getJson(api.baseUrl, "/api/v1/library/summary");
        assert.equal(summary.response.status, 200);
        assert.deepEqual(summary.body.data.categories, []);
        assert.deepEqual(summary.body.data.games, { titles: 0, platforms: 0 });
    });

    it("uses HEAD without a body and reports method and route errors", async () => {
        const head = await fetch(api.baseUrl + "/api/v1/health", { method: "HEAD" });
        assert.equal(head.status, 200);
        assert.equal(await head.text(), "");
        assert.equal(head.headers.get("content-length"), String(Buffer.byteLength('{"status":"ok"}')));

        const method = await getJson(api.baseUrl, "/api/v1/health", { method: "POST" });
        assert.equal(method.response.status, 405);
        assert.equal(method.response.headers.get("allow"), "GET, HEAD");
        assert.equal(method.body.error.code, "method_not_allowed");

        const unknown = await getJson(api.baseUrl, "/api/v1/unknown");
        assert.equal(unknown.response.status, 404);
        assert.equal(unknown.body.error.code, "not_found");
        const headError = await fetch(api.baseUrl + "/api/v1/unknown", { method: "HEAD" });
        assert.equal(headError.status, 404);
        assert.equal(await headError.text(), "");
    });

    it("rejects invalid pagination, filters, years, and IDs", async () => {
        for (const endpoint of [
            "/api/v1/files?limit=0", "/api/v1/files?limit=101",
            "/api/v1/files?offset=-1", "/api/v1/files?offset=1.5",
            "/api/v1/files?offset=9007199254740992",
            "/api/v1/files?q=" + "x".repeat(201),
            "/api/v1/games?year=999", "/api/v1/games?year=10000",
            "/api/v1/games/0", "/api/v1/files/0",
        ]) {
            const { response, body } = await getJson(api.baseUrl, endpoint);
            assert.equal(response.status, 400, endpoint);
            assert.equal(body.error.code, "invalid_parameter", endpoint);
        }
    });
});

describe("server API with indexed files and games", () => {
    let fixture;
    let api;
    let ids;

    before(async () => {
        fixture = createFixture();
        ids = {};
        ids.song = addFile(fixture, "music", "Artist/Album/01 - First.mp3", "0123456789");
        ids.otherSong = addFile(fixture, "music", "Artist/Album Extra/02 - Next.mp3", "next!");
        ids.unicode = addFile(fixture, "music", "Artist/Album/Résumé mix.mp3", "bonjour");
        ids.cover = addFile(fixture, "games", "Wii/Star Fox.png", "cover");
        // A still-existing path outside the configured archive must not be
        // served, even when the indexed relative file exists locally.
        const outsideCover = path.join(fixture.root, "outside-cover.png");
        fs.writeFileSync(outsideCover, "external");
        fixture.db.prepare("UPDATE files SET path = ? WHERE id = ?")
            .run(outsideCover, ids.cover);
        ids.starFile = addFile(fixture, "games", "Wii/Star Fox.iso", "star-fox");
        ids.nebulaFile = addFile(fixture, "games", "PS2/Nebula.iso", "nebula");
        ids.alphaFile = addFile(fixture, "games", "Wii/Alpha.iso", "alpha");
        ids.unknown = addFile(fixture, "pictures", "Trip/raw.unknown", "raw");
        ids.ghost = addFile(fixture, "pictures", "Trip/missing.jpg", "missing", { missing: true });
        ids.empty = addFile(fixture, "videos", "empty.bin", "");
        ids.star = addGame(fixture, ids.starFile, "Wii/Star Fox.iso", "Star Fox", "Wii", 2006,
            "Shooter", ids.cover, "remote-star");
        ids.nebula = addGame(fixture, ids.nebulaFile, "PS2/Nebula.iso", "Nebula",
            "PlayStation 2", 2008, "Adventure", null, "remote-nebula");
        ids.alpha = addGame(fixture, ids.alphaFile, "Wii/Alpha.iso", "Alpha", "Wii",
            2006, "Adventure", null, null);
        // Seed one linked album and track so summary assertions cover populated
        // music counts and duration as well as the empty-index case.
        const artistId = Number(fixture.db.prepare("INSERT INTO artists (name) VALUES (?)")
            .run("Artist").lastInsertRowid);
        const albumId = Number(fixture.db.prepare("INSERT INTO albums (source_key, title) VALUES (?, ?)")
            .run("Artist/Album", "Album").lastInsertRowid);
        fixture.db.prepare("INSERT INTO album_artists (album_id, artist_id) VALUES (?, ?)")
            .run(albumId, artistId);
        fixture.db.prepare("INSERT INTO tracks (file_id, album_id, title, duration_ms) VALUES (?, ?, ?, ?)")
            .run(ids.song, albumId, "First", 1234);
        api = await startApi(fixture.dbPath);
    });
    after(async () => {
        if (api) await stopApi(api.child);
        if (fixture) {
            fixture.db.close();
            fs.rmSync(fixture.root, { recursive: true, force: true });
        }
    });

    it("lists files in stable order with pagination and public paths", async () => {
        const all = await getJson(api.baseUrl, "/api/v1/files");
        assert.equal(all.response.status, 200);
        assert.equal(all.body.pagination.total, 10);
        assert.equal(all.body.pagination.limit, 30);
        assert.deepEqual(all.body.data.map((file) => file.category), [
            "games", "games", "games", "games", "music", "music", "music", "pictures", "pictures", "videos",
        ]);
        for (const file of all.body.data) {
            assert.ok(!Object.hasOwn(file, "path"));
            assert.ok(!file.relative_path.includes("\\"));
            assert.equal(file.content_url, "/api/v1/files/" + file.id + "/content");
        }
        const page = await getJson(api.baseUrl, "/api/v1/files?limit=2&offset=1");
        assert.equal(page.body.data.length, 2);
        assert.deepEqual(page.body.pagination, { limit: 2, offset: 1, total: 10 });
        assert.deepEqual(page.body.data.map((file) => file.id), all.body.data.slice(1, 3).map((file) => file.id));
        const max = await getJson(api.baseUrl, "/api/v1/files?limit=100&offset=100");
        assert.deepEqual(max.body.pagination, { limit: 100, offset: 100, total: 10 });
        assert.deepEqual(max.body.data, []);
    });

    it("combines filters and respects path segment boundaries", async () => {
        const filtered = await getJson(api.baseUrl,
            "/api/v1/files?category=music&path=Artist/Album&extension=MP3&q=first");
        assert.equal(filtered.body.pagination.total, 1);
        assert.deepEqual(filtered.body.data.map((file) => file.id), [ids.song]);
        const prefix = await getJson(api.baseUrl, "/api/v1/files?category=music&path=Artist/Album");
        assert.deepEqual(prefix.body.data.map((file) => file.id), [ids.song, ids.unicode]);
        const query = await getJson(api.baseUrl, "/api/v1/files?q=Trip");
        assert.equal(query.body.pagination.total, 2);
        const noMatch = await getJson(api.baseUrl, "/api/v1/files?category=music&extension=png");
        assert.deepEqual(noMatch.body.data, []);
        assert.equal(noMatch.body.pagination.total, 0);
    });

    it("reports file and game totals from the index", async () => {
        const { body } = await getJson(api.baseUrl, "/api/v1/library/summary");
        assert.deepEqual(body.data.categories, [
            { category: "games", file_count: 4, size_bytes: 24 },
            { category: "music", file_count: 3, size_bytes: 22 },
            { category: "pictures", file_count: 2, size_bytes: 10 },
            { category: "videos", file_count: 1, size_bytes: 0 },
        ]);
        assert.deepEqual(body.data.music, { artists: 1, albums: 1, tracks: 1, duration_ms: 1234 });
        assert.deepEqual(body.data.games, { titles: 3, platforms: 2 });
    });

    it("returns file detail and distinct missing-row and unavailable-file errors", async () => {
        const detail = await getJson(api.baseUrl, "/api/v1/files/" + ids.song);
        assert.equal(detail.response.status, 200);
        assert.equal(detail.body.data.relative_path, "Artist/Album/01 - First.mp3");
        assert.equal(detail.body.data.size_bytes, 10);
        assert.ok(!Object.hasOwn(detail.body.data, "path"));

        const missingRow = await getJson(api.baseUrl, "/api/v1/files/999999/content");
        assert.equal(missingRow.response.status, 404);
        assert.equal(missingRow.body.error.code, "not_found");
        const missingDisk = await getJson(api.baseUrl, "/api/v1/files/" + ids.ghost + "/content");
        assert.equal(missingDisk.response.status, 404);
        assert.equal(missingDisk.body.error.code, "file_unavailable");
        const arbitraryPath = await getJson(api.baseUrl, "/api/v1/files/not-an-id/content");
        assert.equal(arbitraryPath.response.status, 404);
    });

    it("streams full files, attachments, HEAD, unknown types, and zero-byte files", async () => {
        const content = await fetch(api.baseUrl + "/api/v1/files/" + ids.song + "/content");
        assert.equal(content.status, 200);
        assert.equal(content.headers.get("content-type"), "audio/mpeg");
        assert.equal(content.headers.get("content-length"), "10");
        assert.equal(content.headers.get("accept-ranges"), "bytes");
        assert.equal(content.headers.get("content-disposition"), null);
        assert.equal(await content.text(), "0123456789");

        const download = await fetch(api.baseUrl + "/api/v1/files/" + ids.song + "/download");
        assert.equal(download.status, 200);
        assert.match(download.headers.get("content-disposition"), /^attachment; filename=/);
        assert.equal(await download.text(), "0123456789");
        const unicodeDownload = await fetch(api.baseUrl + "/api/v1/files/" + ids.unicode + "/download");
        assert.equal(unicodeDownload.status, 200);
        assert.match(unicodeDownload.headers.get("content-disposition"),
            /filename\*=UTF-8''R%C3%A9sum%C3%A9%20mix\.mp3/);
        assert.equal(await unicodeDownload.text(), "bonjour");

        const head = await fetch(api.baseUrl + "/api/v1/files/" + ids.song + "/content", { method: "HEAD" });
        assert.equal(head.status, 200);
        assert.equal(head.headers.get("content-length"), "10");
        assert.equal(await head.text(), "");

        const unknown = await fetch(api.baseUrl + "/api/v1/files/" + ids.unknown + "/content");
        assert.equal(unknown.headers.get("content-type"), "application/octet-stream");
        assert.deepEqual(Buffer.from(await unknown.arrayBuffer()), Buffer.from("raw"));
        const empty = await fetch(api.baseUrl + "/api/v1/files/" + ids.empty + "/content");
        assert.equal(empty.status, 200);
        assert.equal(empty.headers.get("content-length"), "0");
        assert.equal(await empty.text(), "");
    });

    it("serves closed, open, suffix, and clamped byte ranges", async () => {
        for (const [range, expectedRange, expectedBody] of [
            ["bytes=2-5", "bytes 2-5/10", "2345"],
            ["bytes=7-", "bytes 7-9/10", "789"],
            ["bytes=-3", "bytes 7-9/10", "789"],
            ["bytes=8-99", "bytes 8-9/10", "89"],
        ]) {
            const response = await fetch(api.baseUrl + "/api/v1/files/" + ids.song + "/content", {
                headers: { Range: range },
            });
            assert.equal(response.status, 206, range);
            assert.equal(response.headers.get("content-range"), expectedRange, range);
            assert.equal(response.headers.get("content-length"), String(expectedBody.length), range);
            assert.equal(await response.text(), expectedBody, range);
        }
        const downloadRange = await fetch(api.baseUrl + "/api/v1/files/" + ids.song + "/download", {
            headers: { Range: "bytes=0-1" },
        });
        assert.equal(downloadRange.status, 206);
        assert.equal(downloadRange.headers.get("content-range"), "bytes 0-1/10");
        assert.match(downloadRange.headers.get("content-disposition"), /^attachment;/);
        assert.equal(await downloadRange.text(), "01");
    });

    it("rejects malformed and unsatisfiable ranges", async () => {
        for (const range of ["bytes=", "bytes=10-", "bytes=5-3", "bytes=-0"]) {
            const response = await fetch(api.baseUrl + "/api/v1/files/" + ids.song + "/content", {
                headers: { Range: range },
            });
            assert.equal(response.status, 416, range);
            assert.equal(response.headers.get("content-range"), "bytes */10", range);
            assert.equal(response.headers.get("content-length"), "0", range);
            assert.equal(await response.text(), "", range);
        }
        const emptyRange = await fetch(api.baseUrl + "/api/v1/files/" + ids.empty + "/content", {
            headers: { Range: "bytes=0-" },
        });
        assert.equal(emptyRange.status, 416);
        assert.equal(emptyRange.headers.get("content-range"), "bytes */0");
        assert.equal(await emptyRange.text(), "");
    });

    it("sends the full file when a range is unsupported or cannot apply", async () => {
        for (const headers of [
            { Range: "bytes=0-1,4-5" },
            { Range: "items=0-1" },
            { Range: "bytes=0-1", "If-Range": '"stale-etag"' },
        ]) {
            const response = await fetch(api.baseUrl + "/api/v1/files/" + ids.song + "/content",
                { headers });
            assert.equal(response.status, 200);
            assert.equal(response.headers.get("content-range"), null);
            assert.equal(await response.text(), "0123456789");
        }
        const head = await fetch(api.baseUrl + "/api/v1/files/" + ids.song + "/content", {
            method: "HEAD", headers: { Range: "bytes=2-5" },
        });
        assert.equal(head.status, 200);
        assert.equal(head.headers.get("content-length"), "10");
        assert.equal(head.headers.get("content-range"), null);
        assert.equal(await head.text(), "");
    });

    it("filters and paginates games and chooses local artwork over IGDB artwork", async () => {
        const all = await getJson(api.baseUrl, "/api/v1/games?limit=1&offset=1");
        assert.equal(all.response.status, 200);
        assert.deepEqual(all.body.pagination, { limit: 1, offset: 1, total: 3 });
        assert.deepEqual(all.body.data.map((game) => game.title), ["Nebula"]);
        for (const [query, expected] of [
            ["q=STAR", [ids.star]],
            ["platform=wii", [ids.alpha, ids.star]],
            ["genre=adventure", [ids.alpha, ids.nebula]],
            ["year=2006", [ids.alpha, ids.star]],
            ["platform=Wii&genre=Adventure&year=2006", [ids.alpha]],
        ]) {
            const { body } = await getJson(api.baseUrl, "/api/v1/games?" + query);
            assert.deepEqual(body.data.map((game) => game.id), expected, query);
            assert.equal(body.pagination.total, expected.length, query);
        }
        const local = await getJson(api.baseUrl, "/api/v1/games/" + ids.star);
        assert.equal(local.body.data.artwork_url, "/api/v1/files/" + ids.cover + "/content");
        const cover = await fetch(api.baseUrl + local.body.data.artwork_url);
        assert.equal(cover.status, 200);
        assert.equal(await cover.text(), "cover");
        assert.equal(local.body.data.download_url, "/api/v1/files/" + ids.starFile + "/download");
        assert.equal(local.body.data.relative_path, "Wii/Star Fox.iso");
        const remote = await getJson(api.baseUrl, "/api/v1/games/" + ids.nebula);
        assert.equal(remote.body.data.artwork_url,
            "https://images.igdb.com/igdb/image/upload/t_cover_big/remote-nebula.jpg");
        const noArtwork = await getJson(api.baseUrl, "/api/v1/games/" + ids.alpha);
        assert.equal(noArtwork.body.data.artwork_url, null);
        const absent = await getJson(api.baseUrl, "/api/v1/games/999999");
        assert.equal(absent.response.status, 404);
        assert.equal(absent.body.error.code, "not_found");
    });

    it("returns game facets and server-side sort orders", async () => {
        const facets = await getJson(api.baseUrl, "/api/v1/games/facets");
        assert.deepEqual(facets.body.data, {
            platforms: ["PlayStation 2", "Wii"], genres: ["Adventure", "Shooter"],
        });
        const newest = await getJson(api.baseUrl, "/api/v1/games?sort=newest&limit=2");
        assert.deepEqual(newest.body.data.map((game) => game.id), [ids.nebula, ids.alpha]);
        const oldest = await getJson(api.baseUrl, "/api/v1/games?sort=oldest&limit=2");
        assert.deepEqual(oldest.body.data.map((game) => game.id), [ids.alpha, ids.star]);
        assert.equal((await getJson(api.baseUrl, "/api/v1/games?sort=invalid")).response.status, 400);
    });
});
