const assert = require("node:assert/strict");
const fs = require("node:fs");
const { inflateRawSync } = require("node:zlib");
const { test } = require("node:test");
const { createFixture, closeFixture, writeMedia, runIndexer, startApi, stopApi, getJson } =
    require("../test-support/fixture");

function zipEntries(bytes) {
    const zip = Buffer.from(bytes);
    let end = zip.length - 22;
    while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
    assert.ok(end >= 0, "ZIP directory missing");
    const count = zip.readUInt16LE(end + 10);
    let offset = zip.readUInt32LE(end + 16);
    const entries = new Map();
    for (let index = 0; index < count; index++) {
        assert.equal(zip.readUInt32LE(offset), 0x02014b50);
        const method = zip.readUInt16LE(offset + 10);
        const size = zip.readUInt32LE(offset + 20);
        const nameLength = zip.readUInt16LE(offset + 28);
        const extraLength = zip.readUInt16LE(offset + 30);
        const commentLength = zip.readUInt16LE(offset + 32);
        const localOffset = zip.readUInt32LE(offset + 42);
        const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
        const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) +
            zip.readUInt16LE(localOffset + 28);
        const compressed = zip.subarray(start, start + size);
        entries.set(name, method === 0 ? compressed : inflateRawSync(compressed));
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

test("indexes complete PS1 game sets and downloads each game with required files", async () => {
    const fixture = createFixture();
    let api;
    try {
        const files = [
            ["PS1/Chronicles.m3u", "Chronicles (Disc 1).cue\nChronicles (Disc 2).cue\n"],
            ["PS1/Chronicles (Disc 1).cue", 'FILE "Chronicles (Disc 1) (Track 1).bin" BINARY\n  TRACK 01 MODE2/2352\nFILE "Chronicles (Disc 1) (Track 2).bin" BINARY\n  TRACK 02 AUDIO\n'],
            ["PS1/Chronicles (Disc 1) (Track 1).bin", "first-data"],
            ["PS1/Chronicles (Disc 1) (Track 2).bin", "first-audio"],
            ["PS1/Chronicles (Disc 2).cue", 'FILE "Chronicles (Disc 2).bin" BINARY\n  TRACK 01 MODE2/2352\n'],
            ["PS1/Chronicles (Disc 2).bin", "second-data"],
            ["PS1/Arcade.chd", "standalone"],
            ["PS1/Other (Disc 1).chd", "disc-one"],
            ["PS1/Other (Disc 2).chd", "disc-two"],
            ["PS1/Standalone.cue", 'FILE "Standalone.bin" BINARY\n  TRACK 01 MODE2/2352\n'],
            ["PS1/Standalone.bin", "cue-data"],
            ["PS1/Unusual Alpha.chd", "first-unusual"],
            ["PS1/Unusual Beta.chd", "second-unusual"],
            ["PS1/Unusual Alpha.game.json", JSON.stringify({
                title: "Unusual", discs: ["Unusual Alpha.chd", "Unusual Beta.chd"],
            })],
            ["PS1/Broken.cue", 'FILE "Missing.bin" BINARY\n'],
            ["PS1/Missing Set (Disc 1 of 3).chd", "only-one-disc"],
        ];
        const locations = new Map(files.map(([name, value]) =>
            [name, writeMedia(fixture, "games", name, value)]));
        assert.equal(runIndexer(fixture, "src/indexers/fileIndexer.js").status, 0);
        const oldDisc = fixture.db.prepare("SELECT id FROM files WHERE filename = ?")
            .get("Chronicles (Disc 1).cue");
        const oldGameId = Number(fixture.db.prepare(
            "INSERT INTO games (file_id, source_key, title, platform) VALUES (?, ?, ?, ?)"
        ).run(oldDisc.id, "PS1/Chronicles (Disc 1).cue", "Chronicles", "PS1").lastInsertRowid);
        const indexed = runIndexer(fixture, "src/indexers/gameIndexer.js");
        assert.equal(indexed.status, 0, indexed.stderr);
        assert.match(indexed.stderr, /Skipping incomplete game disc PS1[\\/]Broken.cue/);
        assert.match(indexed.stderr, /Skipping incomplete declared disc set.*Missing Set/);
        const games = fixture.db.prepare("SELECT id, source_key, title FROM games ORDER BY source_key").all();
        assert.deepEqual(games.map(({ source_key, title }) => [source_key, title]), [
            ["PS1/Arcade.chd", "Arcade"],
            ["PS1/Chronicles.m3u", "Chronicles"],
            ["PS1/Other (Disc 1).chd", "Other"],
            ["PS1/Standalone.cue", "Standalone"],
            ["PS1/Unusual Alpha.chd", "Unusual"],
        ]);
        assert.equal(games.find((game) => game.title === "Chronicles").id, oldGameId);
        assert.equal(runIndexer(fixture, "src/indexers/gameIndexer.js").status, 0);
        assert.deepEqual(fixture.db.prepare("SELECT id, source_key, title FROM games ORDER BY source_key").all(), games);
        assert.equal(runIndexer(fixture, "src/indexers/gameIndexer.js", [],
            { GAME_EXTRA_EXTENSIONS: "BIN" }).status, 0);
        assert.deepEqual(fixture.db.prepare("SELECT id, source_key, title FROM games ORDER BY source_key").all(), games);

        api = await startApi(fixture.dbPath);
        const byTitle = Object.fromEntries(games.map((game) => [game.title, game.id]));
        const listing = await getJson(api.baseUrl, "/api/v1/games");
        assert.equal(listing.body.pagination.total, 5);
        const chronicles = listing.body.data.find((game) => game.title === "Chronicles");
        assert.equal(chronicles.disc_count, 2);
        assert.equal(chronicles.file_count, 6);
        assert.equal(chronicles.download_url, `/api/v1/games/${byTitle.Chronicles}/download`);
        const detail = await getJson(api.baseUrl, `/api/v1/games/${byTitle.Chronicles}`);
        assert.deepEqual(detail.body.data.discs.map((disc) => [disc.number, disc.files.length]), [[1, 3], [2, 2]]);
        const downloaded = await fetch(api.baseUrl + chronicles.download_url);
        assert.equal(downloaded.status, 200);
        assert.equal(downloaded.headers.get("content-type"), "application/zip");
        const entries = zipEntries(await downloaded.arrayBuffer());
        assert.deepEqual([...entries.keys()].sort(), files.slice(0, 6)
            .map(([name]) => "Chronicles/" + name.slice("PS1/".length)).sort());
        assert.match(entries.get("Chronicles/Chronicles (Disc 1).cue").toString(),
            /Chronicles \(Disc 1\) \(Track 1\)\.bin/);
        assert.equal(entries.get("Chronicles/Chronicles (Disc 2).bin").toString(), "second-data");

        const grouped = await getJson(api.baseUrl, `/api/v1/games/${byTitle.Other}`);
        assert.equal(grouped.body.data.disc_count, 2);
        assert.equal(grouped.body.data.file_count, 2);
        const oneFile = await fetch(api.baseUrl + `/api/v1/games/${byTitle.Arcade}/download`);
        assert.equal(await oneFile.text(), "standalone");
        assert.match(oneFile.headers.get("content-disposition"), /Arcade\.chd/);
        const oneDiscCue = await fetch(api.baseUrl + `/api/v1/games/${byTitle.Standalone}/download`);
        assert.deepEqual([...zipEntries(await oneDiscCue.arrayBuffer()).keys()].sort(),
            ["Standalone/Standalone.bin", "Standalone/Standalone.cue"]);
        const head = await fetch(api.baseUrl + chronicles.download_url, { method: "HEAD" });
        assert.equal(head.status, 200);
        assert.equal(await head.text(), "");

        fs.rmSync(locations.get("PS1/Chronicles (Disc 2).bin"));
        const missing = await getJson(api.baseUrl, chronicles.download_url);
        assert.equal(missing.response.status, 409);
        assert.equal(missing.body.error.code, "game_incomplete");
        fixture.db.prepare("DELETE FROM files WHERE filename = ?")
            .run("Chronicles (Disc 2).bin");
        const pruned = await getJson(api.baseUrl, `/api/v1/games/${byTitle.Chronicles}`);
        assert.equal(pruned.body.data.is_complete, false);
        assert.equal(pruned.body.data.file_count, 6);
        assert.equal((await getJson(api.baseUrl, chronicles.download_url)).response.status, 409);
    } finally {
        if (api) await stopApi(api.child);
        closeFixture(fixture);
    }
});

test("recognizes GDI and companion-image manifests without indexing their tracks as games", () => {
    const fixture = createFixture();
    try {
        for (const [name, value] of [
            ["Dreamcast/GDI Game.gdi", "1\n1 0 4 2352 track01.bin 0\n"],
            ["Dreamcast/track01.bin", "track"],
            ["PS1/CCD Game.ccd", "[CloneCD]\n"],
            ["PS1/CCD Game.img", "image"],
            ["PS1/CCD Game.sub", "subchannels"],
            ["PS1/MDS Game.mds", "descriptor"],
            ["PS1/MDS Game.mdf", "image"],
            ["PS1/Unsafe.cue", 'FILE "../../outside.bin" BINARY\n'],
        ]) writeMedia(fixture, "games", name, value);
        assert.equal(runIndexer(fixture, "src/indexers/fileIndexer.js").status, 0);
        const result = runIndexer(fixture, "src/indexers/gameIndexer.js");
        assert.equal(result.status, 0, result.stderr);
        const rows = fixture.db.prepare(
            "SELECT g.title, COUNT(gf.file_id) AS file_count FROM games g " +
            "JOIN game_files gf ON gf.game_id = g.id GROUP BY g.id ORDER BY g.title"
        ).all();
        assert.deepEqual(rows, [
            { title: "CCD Game", file_count: 3 },
            { title: "GDI Game", file_count: 2 },
            { title: "MDS Game", file_count: 2 },
        ]);
        assert.match(result.stderr, /Skipping incomplete game disc.*Unsafe.cue/);
    } finally {
        closeFixture(fixture);
    }
});
