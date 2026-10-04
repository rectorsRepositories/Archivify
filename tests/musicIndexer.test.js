const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { it } = require("node:test");
const { createFixture, closeFixture, runIndexer, writeMedia } = require("../test-support/fixture");

function pcmWav(infoTags = {}) {
    const audio = Buffer.alloc(800, 128); // 100 ms of unsigned 8-bit silence at 8 kHz.
    const infoChunks = Object.entries(infoTags).map(([tag, value]) => {
        const text = Buffer.from(value + "\0");
        const chunk = Buffer.alloc(8 + text.length + (text.length % 2));
        chunk.write(tag, 0);
        chunk.writeUInt32LE(text.length, 4);
        text.copy(chunk, 8);
        return chunk;
    });
    const info = infoChunks.length ? Buffer.concat([Buffer.from("INFO"), ...infoChunks]) : null;
    const list = info ? Buffer.alloc(8 + info.length) : Buffer.alloc(0);
    if (info) {
        list.write("LIST", 0);
        list.writeUInt32LE(info.length, 4);
        info.copy(list, 8);
    }
    const wav = Buffer.alloc(44 + audio.length + list.length);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(8000, 28);
    wav.writeUInt16LE(1, 32);
    wav.writeUInt16LE(8, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(audio.length, 40);
    audio.copy(wav, 44);
    list.copy(wav, 44 + audio.length);
    return wav;
}

it("reads tagged and untagged WAV files with the real metadata parser", () => {
    const fixture = createFixture();
    try {
        writeMedia(fixture, "music", "wav/No_Tags/Simple/01 - Tone.wav", pcmWav());
        writeMedia(fixture, "music", "wav/Folder_Artist/Folder_Album/01 - Filename.wav", pcmWav({
            INAM: "Tagged Tone", IART: "Tagged Artist", IPRD: "Tagged Album",
            ICRD: "2022-03-04", IGNR: "Jazz", ITRK: "4",
        }));
        writeMedia(fixture, "music", "wav/Folder_Artist/Folder_Album/cover.png",
            Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0XcAAAAASUVORK5CYII=", "base64"));
        assert.equal(runIndexer(fixture, "src/indexers/fileIndexer.js").status, 0);
        const result = runIndexer(fixture, "src/indexers/musicIndexer.js");
        assert.equal(result.status, 0, result.stderr);
        const rows = fixture.db.prepare(
            "SELECT a.source_key, a.title AS album_title, a.release_year, a.genre, " +
            "t.title, t.duration_ms, t.track_number, f.filename AS cover " +
            "FROM tracks t JOIN albums a ON a.id = t.album_id " +
            "LEFT JOIN files f ON f.id = a.artwork_file_id ORDER BY a.source_key"
        ).all();
        assert.deepEqual(rows, [
            { source_key: "wav/Folder_Artist/Folder_Album", album_title: "Tagged Album",
                release_year: 2022, genre: "Jazz", title: "Tagged Tone", duration_ms: 100,
                track_number: 4, cover: "cover.png" },
            { source_key: "wav/No_Tags/Simple", album_title: "Simple", release_year: null,
                genre: null, title: "Tone", duration_ms: 100, track_number: 1, cover: null },
        ]);
        assert.deepEqual(fixture.db.prepare(
            "SELECT ar.name FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id " +
            "JOIN albums a ON a.id = aa.album_id WHERE a.source_key = ?"
        ).all("wav/Folder_Artist/Folder_Album"), [{ name: "Folder Artist" }]);
        assert.deepEqual(fixture.db.prepare(
            "SELECT ar.name FROM track_artists ta JOIN artists ar ON ar.id = ta.artist_id " +
            "JOIN tracks t ON t.id = ta.track_id WHERE t.title = ?"
        ).all("Tagged Tone"), [{ name: "Tagged Artist" }]);
    } finally {
        closeFixture(fixture);
    }
});

it("reconciles empty albums and unused artists after file pruning without changing retained album IDs", () => {
    const fixture = createFixture();
    try {
        const oldPath = writeMedia(fixture, "music",
            "wav/Keep_Artist/Keep_Album/01 - Old.wav", pcmWav());
        const gonePath = writeMedia(fixture, "music",
            "wav/Remove_Artist/Remove_Album/01 - Gone.wav", pcmWav());
        assert.equal(runIndexer(fixture, "src/indexers/fileIndexer.js").status, 0);
        assert.equal(runIndexer(fixture, "src/indexers/musicIndexer.js").status, 0);
        const keptAlbum = fixture.db.prepare("SELECT id FROM albums WHERE source_key = ?")
            .get("wav/Keep_Artist/Keep_Album");
        assert.ok(keptAlbum);
        assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM albums").get().count, 2);

        fs.unlinkSync(oldPath);
        fs.unlinkSync(gonePath);
        writeMedia(fixture, "music", "wav/Keep_Artist/Keep_Album/01 - New.wav", pcmWav());
        const prune = runIndexer(fixture, "src/indexers/fileIndexer.js", ["--prune"]);
        assert.equal(prune.status, 0, prune.stderr);
        // At this stage the old tracks are gone, but album reconciliation waits
        // until the replacement track has been indexed.
        assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM albums").get().count, 2);
        const reindex = runIndexer(fixture, "src/indexers/musicIndexer.js");
        assert.equal(reindex.status, 0, reindex.stderr);
        assert.match(reindex.stdout, /Empty albums removed: 1/);
        assert.match(reindex.stdout, /Unused artists removed: 1/);
        assert.deepEqual(fixture.db.prepare("SELECT id, source_key FROM albums").all(), [
            { id: keptAlbum.id, source_key: "wav/Keep_Artist/Keep_Album" },
        ]);
        assert.deepEqual(fixture.db.prepare("SELECT title FROM tracks").all(), [{ title: "New" }]);
        assert.deepEqual(fixture.db.prepare("SELECT name FROM artists").all(), [{ name: "Keep Artist" }]);
    } finally {
        closeFixture(fixture);
    }
});

it("indexes music tags and fallbacks, chooses artwork, and updates links on retag", async () => {
    const fixture = createFixture();
    const originalDbPath = process.env.ARCHIVE_DB;
    let moduleLoaded = false;
    try {
        const firstPath = writeMedia(fixture, "music",
            "flac/Folder_Artist/Folder_Album/01 - First.flac", "first");
        writeMedia(fixture, "music", "flac/Folder_Artist/Folder_Album/CD2/01 - Second.flac", "second");
        writeMedia(fixture, "music", "flac/Folder_Artist/Folder_Album/cover.jpg", "cover");
        writeMedia(fixture, "music", "flac/Folder_Artist/Folder_Album/folder.png", "folder");
        writeMedia(fixture, "music", "mp3/Other_Artist/No_Cover/01 - Embedded.mp3", "embedded");
        writeMedia(fixture, "music", "Loose.mp3", "loose");
        assert.equal(runIndexer(fixture, "src/indexers/fileIndexer.js").status, 0);

        process.env.ARCHIVE_DB = fixture.dbPath;
        const { runMusicIndexer, parseMusicFile, trackDetails } = require("../src/indexers/musicIndexer");
        moduleLoaded = true;
        assert.deepEqual(trackDetails("03 - Song_Name.mp3", 2), {
            title: "Song Name", trackNumber: 3, discNumber: 2,
        });
        assert.equal(parseMusicFile({ id: 1, path: firstPath, filename: "Loose.mp3",
            relative_path: "Loose.mp3" }), null);

        let retag = false;
        const optionsSeen = new Map();
        const metadataReader = {
            async parseFile(filePath, options) {
                const name = path.basename(filePath);
                optionsSeen.set(name, options);
                if (name === "01 - Second.flac") throw new Error("bad tags");
                if (name === "01 - First.flac") {
                    return {
                        common: {
                            album: retag ? "Retagged Album" : "Tagged Album",
                            albumartists: retag ? ["Carol"] : ["Alice", "Bob", "alice"],
                            title: retag ? "Retagged First" : "Tagged First",
                            artists: retag ? ["Solo"] : ["Singer", "Guest", "singer"],
                            track: { no: 2 }, disk: { no: 1 }, year: 2020, genre: ["Rock"],
                        },
                        format: { duration: 1.234 },
                    };
                }
                return {
                    common: {
                        album: "Embedded Album", albumartist: "Other Artist",
                        title: "Embedded Track", artist: "Other Artist",
                        releasedate: "2019-04-02", genre: ["Ambient"],
                        picture: retag ? [] : [{ format: "image/png", data: Buffer.from("artwork") }],
                    },
                    format: { duration: 2.5 },
                };
            },
            selectCover(pictures) { return pictures?.[0]; },
        };

        const first = await runMusicIndexer(metadataReader);
        assert.deepEqual({
            audioFiles: first.audioFiles, skipped: first.skipped,
            metadataErrors: first.metadataErrors, missingDurations: first.missingDurations,
            albumsIndexed: first.albumsIndexed, tracksIndexed: first.tracksIndexed,
        }, {
            audioFiles: 4, skipped: 1, metadataErrors: 1, missingDurations: 1,
            albumsIndexed: 2, tracksIndexed: 3,
        });
        assert.equal(optionsSeen.get("01 - First.flac").skipCovers, true);
        assert.equal(optionsSeen.get("01 - Embedded.mp3").skipCovers, false);

        const albums = fixture.db.prepare(
            "SELECT a.id, a.source_key, a.title, a.release_year, a.genre, f.filename AS cover " +
            "FROM albums a LEFT JOIN files f ON f.id = a.artwork_file_id ORDER BY a.source_key"
        ).all();
        assert.deepEqual(albums.map(({ source_key, title, cover }) => ({ source_key, title, cover })), [
            { source_key: "flac/Folder_Artist/Folder_Album", title: "Tagged Album", cover: "cover.jpg" },
            { source_key: "mp3/Other_Artist/No_Cover", title: "Embedded Album", cover: null },
        ]);
        const embeddedId = albums[1].id;
        assert.deepEqual(fixture.db.prepare(
            "SELECT mime_type, image_data FROM album_artwork WHERE album_id = ?"
        ).get(embeddedId), { mime_type: "image/png", image_data: Buffer.from("artwork") });

        const tracks = fixture.db.prepare(
            "SELECT t.id, t.title, t.track_number, t.disc_number, t.duration_ms, t.release_year, t.genre " +
            "FROM tracks t ORDER BY t.title"
        ).all();
        assert.deepEqual(tracks.map(({ title, track_number, disc_number, duration_ms }) => ({
            title, track_number, disc_number, duration_ms,
        })), [
            { title: "Embedded Track", track_number: 1, disc_number: null, duration_ms: 2500 },
            { title: "Second", track_number: 1, disc_number: 2, duration_ms: null },
            { title: "Tagged First", track_number: 2, disc_number: 1, duration_ms: 1234 },
        ]);
        assert.equal(albums[0].release_year, 2020);
        assert.equal(albums[0].genre, "Rock");
        assert.equal(albums[1].release_year, 2019);
        assert.deepEqual(fixture.db.prepare(
            "SELECT ar.name FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id " +
            "WHERE aa.album_id = ? ORDER BY ar.name"
        ).all(albums[0].id).map((row) => row.name), ["Alice", "Bob"]);
        assert.deepEqual(fixture.db.prepare(
            "SELECT ar.name FROM track_artists ta JOIN artists ar ON ar.id = ta.artist_id " +
            "JOIN tracks t ON t.id = ta.track_id WHERE t.title = ? ORDER BY ar.name"
        ).all("Second").map((row) => row.name), ["Folder Artist"]);

        retag = true;
        const second = await runMusicIndexer(metadataReader);
        assert.equal(second.albumsCreated, 0);
        assert.equal(second.tracksCreated, 0);
        assert.deepEqual(fixture.db.prepare("SELECT id, source_key FROM albums ORDER BY source_key").all(),
            albums.map(({ id, source_key }) => ({ id, source_key })));
        assert.deepEqual(fixture.db.prepare("SELECT id FROM tracks ORDER BY id").all().map((row) => row.id),
            tracks.map((row) => row.id).sort((a, b) => a - b));
        assert.equal(fixture.db.prepare("SELECT title FROM albums WHERE id = ?")
            .get(albums[0].id).title, "Retagged Album");
        assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM album_artwork WHERE album_id = ?")
            .get(embeddedId).count, 0);
        assert.deepEqual(fixture.db.prepare(
            "SELECT ar.name FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id " +
            "WHERE aa.album_id = ?"
        ).all(albums[0].id).map((row) => row.name), ["Carol"]);
        assert.deepEqual(fixture.db.prepare(
            "SELECT ar.name FROM track_artists ta JOIN artists ar ON ar.id = ta.artist_id " +
            "JOIN tracks t ON t.id = ta.track_id WHERE t.title = ?"
        ).all("Retagged First").map((row) => row.name), ["Solo"]);
    } finally {
        if (moduleLoaded) require("../src/db/database").close();
        if (originalDbPath === undefined) delete process.env.ARCHIVE_DB;
        else process.env.ARCHIVE_DB = originalDbPath;
        closeFixture(fixture);
    }
});
