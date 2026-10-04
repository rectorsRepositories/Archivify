const assert = require("node:assert/strict");
const { inflateRawSync } = require("node:zlib");
const { after, before, describe, it } = require("node:test");
const { createFixture, closeFixture, addFile, startApi, stopApi, getJson } =
    require("../test-support/fixture");

function zipEntries(bytes) {
    const zip = Buffer.from(bytes);
    let end = zip.length - 22;
    while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
    assert.ok(end >= 0, "ZIP end-of-central-directory record missing");
    const count = zip.readUInt16LE(end + 10);
    let offset = zip.readUInt32LE(end + 16);
    const entries = new Map();
    for (let index = 0; index < count; index++) {
        assert.equal(zip.readUInt32LE(offset), 0x02014b50);
        const method = zip.readUInt16LE(offset + 10);
        const compressedSize = zip.readUInt32LE(offset + 20);
        const nameLength = zip.readUInt16LE(offset + 28);
        const extraLength = zip.readUInt16LE(offset + 30);
        const commentLength = zip.readUInt16LE(offset + 32);
        const localOffset = zip.readUInt32LE(offset + 42);
        const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
        assert.equal(zip.readUInt32LE(localOffset), 0x04034b50);
        const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) +
            zip.readUInt16LE(localOffset + 28);
        const compressed = zip.subarray(dataStart, dataStart + compressedSize);
        assert.ok(method === 0 || method === 8, "unexpected ZIP compression method");
        entries.set(name, method === 0 ? compressed : inflateRawSync(compressed));
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

describe("music API and album downloads", () => {
    let fixture;
    let api;
    let ids;

    before(async () => {
        fixture = createFixture();
        fixture.db.pragma("foreign_keys = ON");
        ids = {};
        ids.first = addFile(fixture, "music", "Alice/Album/01.mp3", "first");
        ids.second = addFile(fixture, "music", "Alice/Album/02.mp3", "second");
        ids.cover = addFile(fixture, "music", "Alice/Album/cover.jpg", "cover");
        addFile(fixture, "music", "Alice/Album/readme.txt", "notes");
        ids.extra = addFile(fixture, "music", "Alice/Album Extra/01.mp3", "extra");
        ids.embeddedFile = addFile(fixture, "music", "Other/Embedded/01.mp3", "embed");
        addFile(fixture, "music", "Other/Missing/01.mp3", "absent", { missing: true });
        // These indexed names collide after ZIP sanitization, but their disk paths are valid.
        const unsafeA = addFile(fixture, "music", "Alice/Album/safe-a.txt", "A");
        const unsafeB = addFile(fixture, "music", "Alice/Album/safe-b.txt", "B");
        fixture.db.prepare("UPDATE files SET relative_path = ? WHERE id = ?")
            .run("Alice/Album/a:b.txt", unsafeA);
        fixture.db.prepare("UPDATE files SET relative_path = ? WHERE id = ?")
            .run("Alice/Album/a?b.txt", unsafeB);

        const artist = fixture.db.prepare("INSERT INTO artists (name) VALUES (?)");
        ids.alice = Number(artist.run("Alice").lastInsertRowid);
        ids.guest = Number(artist.run("Guest").lastInsertRowid);
        ids.other = Number(artist.run("Other").lastInsertRowid);
        const album = fixture.db.prepare(
            "INSERT INTO albums (source_key, title, release_year, genre, artwork_file_id) " +
            "VALUES (?, ?, ?, ?, ?)"
        );
        ids.album = Number(album.run("Alice/Album", "Album", 2020, "Rock", ids.cover).lastInsertRowid);
        ids.albumExtra = Number(album.run("Alice/Album Extra", "Album Extra", 2021,
            "Pop", null).lastInsertRowid);
        ids.embedded = Number(album.run("Other/Embedded", "Embedded", 2019,
            "Ambient", null).lastInsertRowid);
        ids.empty = Number(album.run("Other/Empty", "Empty", null, null, null).lastInsertRowid);
        ids.missing = Number(album.run("Other/Missing", "Missing", null, null, null).lastInsertRowid);
        fixture.db.prepare("INSERT INTO album_artwork VALUES (?, ?, ?)")
            .run(ids.embedded, "image/png", Buffer.from("embedded-art"));
        const albumArtist = fixture.db.prepare("INSERT INTO album_artists VALUES (?, ?)");
        for (const [albumId, artistId] of [
            [ids.album, ids.alice], [ids.album, ids.guest], [ids.albumExtra, ids.alice],
            [ids.embedded, ids.other],
        ]) albumArtist.run(albumId, artistId);
        const track = fixture.db.prepare(
            "INSERT INTO tracks (file_id, album_id, title, track_number, disc_number, duration_ms, " +
            "release_year, genre) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        ids.track1 = Number(track.run(ids.first, ids.album, "First", 1, 1,
            1000, 2020, "Rock").lastInsertRowid);
        ids.track2 = Number(track.run(ids.second, ids.album, "Second", 1, 2,
            null, 2020, "Rock").lastInsertRowid);
        ids.trackExtra = Number(track.run(ids.extra, ids.albumExtra, "Extra", 1, 1,
            2000, 2021, "Pop").lastInsertRowid);
        ids.trackEmbedded = Number(track.run(ids.embeddedFile, ids.embedded, "Atmosphere", 1, 1,
            1500, 2019, "Ambient").lastInsertRowid);
        const trackArtist = fixture.db.prepare("INSERT INTO track_artists VALUES (?, ?)");
        for (const [trackId, artistId] of [
            [ids.track1, ids.alice], [ids.track2, ids.guest],
            [ids.trackExtra, ids.alice], [ids.trackEmbedded, ids.other],
        ]) trackArtist.run(trackId, artistId);
        api = await startApi(fixture.dbPath);
    });

    after(async () => {
        if (api) await stopApi(api.child);
        if (fixture) closeFixture(fixture);
    });

    it("lists artists with counts, search, pagination, and detail errors", async () => {
        const all = await getJson(api.baseUrl, "/api/v1/music/artists?limit=2");
        assert.equal(all.response.status, 200);
        assert.deepEqual(all.body.pagination, { limit: 2, offset: 0, total: 3 });
        assert.deepEqual(all.body.data.map((artist) => artist.name), ["Alice", "Guest"]);
        assert.deepEqual(all.body.data[0], {
            id: ids.alice, name: "Alice", album_count: 2, track_count: 2,
            albums_url: "/api/v1/music/albums?artist_id=" + ids.alice,
        });
        const search = await getJson(api.baseUrl, "/api/v1/music/artists?q=GUE");
        assert.deepEqual(search.body.data.map((artist) => artist.id), [ids.guest]);
        const detail = await getJson(api.baseUrl, "/api/v1/music/artists/" + ids.other);
        assert.equal(detail.body.data.name, "Other");
        const missing = await getJson(api.baseUrl, "/api/v1/music/artists/999999");
        assert.equal(missing.response.status, 404);
    });

    it("filters albums and reports aggregates, artwork, and related URLs", async () => {
        const album = await getJson(api.baseUrl, "/api/v1/music/albums/" + ids.album);
        assert.equal(album.response.status, 200);
        assert.deepEqual(album.body.data.artists.map((artist) => artist.name), ["Alice", "Guest"]);
        assert.equal(album.body.data.track_count, 2);
        assert.equal(album.body.data.duration_ms, null); // One track lacks duration.
        assert.equal(album.body.data.size_bytes, 11);
        assert.equal(album.body.data.artwork_url, "/api/v1/music/albums/" + ids.album + "/artwork");
        assert.equal(album.body.data.tracks_url, "/api/v1/music/albums/" + ids.album + "/tracks");
        assert.equal(album.body.data.download_url, "/api/v1/music/albums/" + ids.album + "/download");

        for (const [query, expected] of [
            ["q=guest", [ids.album]],
            ["artist_id=" + ids.alice, [ids.album, ids.albumExtra]],
            ["year=2019", [ids.embedded]],
            ["genre=pop", [ids.albumExtra]],
            ["artist_id=" + ids.alice + "&year=2020&genre=rock", [ids.album]],
        ]) {
            const { body } = await getJson(api.baseUrl, "/api/v1/music/albums?" + query);
            assert.deepEqual(body.data.map((item) => item.id), expected, query);
            assert.equal(body.pagination.total, expected.length, query);
        }
        const page = await getJson(api.baseUrl, "/api/v1/music/albums?limit=1&offset=1");
        assert.deepEqual(page.body.pagination, { limit: 1, offset: 1, total: 5 });
        const embedded = await getJson(api.baseUrl, "/api/v1/music/albums/" + ids.embedded);
        assert.equal(embedded.body.data.duration_ms, 1500);
        assert.ok(embedded.body.data.artwork_url);
        const absent = await getJson(api.baseUrl, "/api/v1/music/albums/999999");
        assert.equal(absent.response.status, 404);
        const invalidArtist = await getJson(api.baseUrl, "/api/v1/music/albums?artist_id=0");
        assert.equal(invalidArtist.response.status, 400);
    });

    it("orders tracks by disc and number and applies track filters", async () => {
        const albumTracks = await getJson(api.baseUrl,
            "/api/v1/music/albums/" + ids.album + "/tracks");
        assert.deepEqual(albumTracks.body.data.map((track) => track.id), [ids.track1, ids.track2]);
        assert.equal(albumTracks.body.data[0].content_url,
            "/api/v1/files/" + ids.first + "/content");
        assert.deepEqual(albumTracks.body.data[1].artists.map((artist) => artist.name), ["Guest"]);
        for (const [query, expected] of [
            ["q=guest", [ids.track2]],
            ["album_id=" + ids.album, [ids.track1, ids.track2]],
            ["artist_id=" + ids.alice, [ids.track1, ids.trackExtra]],
            ["year=2019&genre=ambient", [ids.trackEmbedded]],
        ]) {
            const { body } = await getJson(api.baseUrl, "/api/v1/music/tracks?" + query);
            assert.deepEqual(body.data.map((track) => track.id), expected, query);
        }
        const detail = await getJson(api.baseUrl, "/api/v1/music/tracks/" + ids.track1);
        assert.equal(detail.body.data.title, "First");
        assert.equal((await getJson(api.baseUrl, "/api/v1/music/tracks/999999")).response.status, 404);
        assert.equal((await getJson(api.baseUrl, "/api/v1/music/albums/999999/tracks")).response.status, 404);
        assert.equal((await getJson(api.baseUrl, "/api/v1/music/tracks?year=10000")).response.status, 400);
    });

    it("serves local and embedded artwork with correct GET and HEAD behavior", async () => {
        const local = await fetch(api.baseUrl + "/api/v1/music/albums/" + ids.album + "/artwork");
        assert.equal(local.status, 200);
        assert.equal(local.headers.get("content-type"), "image/jpeg");
        assert.equal(await local.text(), "cover");
        const embedded = await fetch(api.baseUrl + "/api/v1/music/albums/" + ids.embedded + "/artwork");
        assert.equal(embedded.status, 200);
        assert.equal(embedded.headers.get("content-type"), "image/png");
        assert.equal(embedded.headers.get("content-length"), "12");
        assert.equal(await embedded.text(), "embedded-art");
        const head = await fetch(api.baseUrl + "/api/v1/music/albums/" + ids.embedded + "/artwork",
            { method: "HEAD" });
        assert.equal(head.status, 200);
        assert.equal(head.headers.get("content-length"), "12");
        assert.equal(await head.text(), "");
        assert.equal((await getJson(api.baseUrl,
            "/api/v1/music/albums/" + ids.albumExtra + "/artwork")).response.status, 404);
        assert.equal((await getJson(api.baseUrl,
            "/api/v1/music/albums/999999/artwork")).response.status, 404);
    });

    it("streams a safe album ZIP with sidecars and no files from a similarly named album", async () => {
        const response = await fetch(api.baseUrl + "/api/v1/music/albums/" + ids.album + "/download");
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "application/zip");
        assert.match(response.headers.get("content-disposition"), /filename="Album\.zip"/);
        const entries = zipEntries(await response.arrayBuffer());
        assert.deepEqual([...entries.keys()].sort(), [
            "Album/01.mp3", "Album/02.mp3", "Album/a_b (2).txt", "Album/a_b.txt",
            "Album/cover.jpg", "Album/readme.txt",
        ]);
        assert.equal(entries.get("Album/01.mp3").toString(), "first");
        assert.equal(entries.get("Album/a_b.txt").toString(), "A");
        assert.equal(entries.get("Album/a_b (2).txt").toString(), "B");
        assert.ok(!entries.has("Album Extra/01.mp3"));

        const head = await fetch(api.baseUrl + "/api/v1/music/albums/" + ids.album + "/download",
            { method: "HEAD" });
        assert.equal(head.status, 200);
        assert.equal(head.headers.get("content-type"), "application/zip");
        assert.equal(await head.text(), "");
    });

    it("refuses an incomplete album and one with no indexed files", async () => {
        const incomplete = await getJson(api.baseUrl,
            "/api/v1/music/albums/" + ids.missing + "/download");
        assert.equal(incomplete.response.status, 409);
        assert.equal(incomplete.body.error.code, "album_incomplete");
        const empty = await getJson(api.baseUrl,
            "/api/v1/music/albums/" + ids.empty + "/download");
        assert.equal(empty.response.status, 404);
        assert.equal(empty.body.error.code, "album_files_unavailable");
        const unknown = await getJson(api.baseUrl, "/api/v1/music/albums/999999/download");
        assert.equal(unknown.response.status, 404);
    });
});
