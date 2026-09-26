const path = require("node:path");

const db = require("../db/database");

// Run fileIndexer first so every audio file and cover image has a files row.
require("../db/schema");

const AUDIO_EXTENSIONS = new Set([
    ".flac", ".mp3", ".m4a", ".aac", ".ogg", ".opus",
    ".wav", ".aif", ".aiff", ".wma", ".alac", ".ape",
]);

const IMAGE_EXTENSIONS = new Set([
    ".jpg", ".jpeg", ".png", ".webp",
]);

const FORMAT_DIRECTORIES = new Set([
    "flac", "mp3", "m4a", "aac", "ogg", "opus",
    "wav", "aiff", "alac", "lossless", "lossy",
]);

const COVER_NAMES = new Map([
    ["cover", 0],
    ["folder", 1],
    ["front", 2],
    ["album", 3],
]);

const MAX_EMBEDDED_ART_BYTES = 10 * 1024 * 1024;

const getMusicFiles = db.prepare(
    "SELECT id, path, relative_path, filename, extension FROM files " +
    "WHERE category = 'music' ORDER BY relative_path COLLATE NOCASE, id"
);

const getAlbumByKey = db.prepare(
    "SELECT id FROM albums WHERE source_key = ?"
);

const insertAlbum = db.prepare(
    "INSERT INTO albums (source_key, title, release_year, genre, artwork_file_id) " +
    "VALUES (?, ?, ?, ?, ?)"
);

const updateAlbum = db.prepare(
    "UPDATE albums SET title = ?, release_year = ?, genre = ?, artwork_file_id = ? " +
    "WHERE id = ?"
);

const saveEmbeddedArtwork = db.prepare(
    "INSERT INTO album_artwork (album_id, mime_type, image_data) VALUES (?, ?, ?) " +
    "ON CONFLICT(album_id) DO UPDATE SET " +
    "mime_type = excluded.mime_type, image_data = excluded.image_data"
);

const deleteEmbeddedArtwork = db.prepare(
    "DELETE FROM album_artwork WHERE album_id = ?"
);

const getTrackByFile = db.prepare(
    "SELECT id FROM tracks WHERE file_id = ?"
);

const insertTrack = db.prepare(
    "INSERT INTO tracks " +
    "(file_id, album_id, title, track_number, disc_number, duration_ms, release_year, genre) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);

const updateTrack = db.prepare(
    "UPDATE tracks SET album_id = ?, title = ?, track_number = ?, disc_number = ?, " +
    "duration_ms = ?, release_year = ?, genre = ? WHERE id = ?"
);

const insertArtist = db.prepare(
    "INSERT INTO artists (name) VALUES (?) ON CONFLICT(name) DO NOTHING"
);

const getArtist = db.prepare(
    "SELECT id FROM artists WHERE name = ?"
);

const clearAlbumArtists = db.prepare(
    "DELETE FROM album_artists WHERE album_id = ?"
);

const linkAlbumArtist = db.prepare(
    "INSERT INTO album_artists (album_id, artist_id) VALUES (?, ?)"
);

const clearTrackArtists = db.prepare(
    "DELETE FROM track_artists WHERE track_id = ?"
);

const linkTrackArtist = db.prepare(
    "INSERT INTO track_artists (track_id, artist_id) VALUES (?, ?)"
);

function displayName(value) {
    return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function tagText(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function tagNames(plural, singular) {
    const names = [];
    const seen = new Set();

    for (const value of Array.isArray(plural) ? plural : []) {
        const name = tagText(value);
        const key = name.toLowerCase();

        if (name && !seen.has(key)) {
            names.push(name);
            seen.add(key);
        }
    }

    if (names.length === 0) {
        const name = tagText(singular);

        if (name) {
            names.push(name);
        }
    }

    return names;
}

function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function releaseYear(common) {
    const taggedYear = positiveInteger(common.year);

    if (taggedYear && taggedYear >= 1000 && taggedYear <= 9999) {
        return taggedYear;
    }

    for (const date of [common.releasedate, common.date]) {
        const match = /^(\d{4})/.exec(tagText(date));

        if (match) {
            return Number(match[1]);
        }
    }

    return null;
}

function primaryGenre(common) {
    const genres = Array.isArray(common.genre) ? common.genre : [common.genre];
    return genres.map(tagText).find(Boolean) || null;
}

function discNumberFromDirectories(directories) {
    for (const directory of directories) {
        const match = /^(?:cd|disc|disk)[\s._-]*(\d{1,2})$/i.exec(directory);

        if (match) {
            return Number(match[1]);
        }
    }

    return null;
}

function trackDetails(filename, directoryDiscNumber) {
    const stem = path.parse(filename).name;
    let title = stem;
    let trackNumber = null;
    let discNumber = directoryDiscNumber;

    const discAndTrack = /^(\d{1,2})\s*[-._]\s*(\d{1,2})\s*[-._]\s*(.+)$/.exec(stem);
    const numberedTrack = /^(\d{1,2})\s*[-._]\s*(.+)$/.exec(stem)
        || /^(\d{1,2})\s+(.+)$/.exec(stem);

    if (discAndTrack) {
        discNumber = Number(discAndTrack[1]);
        trackNumber = Number(discAndTrack[2]);
        title = discAndTrack[3];
    } else if (numberedTrack) {
        trackNumber = Number(numberedTrack[1]);
        title = numberedTrack[2];
    }

    return { title: displayName(title), trackNumber, discNumber };
}

function parseMusicFile(file) {
    // fileIndexer stores native separators, so accept both Windows and POSIX paths.
    const parts = file.relative_path.split(/[\\/]+/).filter(Boolean);
    const formatOffset = FORMAT_DIRECTORIES.has(parts[0]?.toLowerCase()) ? 1 : 0;

    if (parts.length - formatOffset < 3) {
        return null;
    }

    const folderArtist = displayName(parts[formatOffset]);
    const folderAlbum = displayName(parts[formatOffset + 1]);

    if (!folderArtist || !folderAlbum) {
        return null;
    }

    return {
        albumKey: parts.slice(0, formatOffset + 2).join("/"),
        folderArtist,
        folderAlbum,
        fileId: file.id,
        filePath: file.path,
        relativePath: file.relative_path,
        ...trackDetails(
            file.filename,
            discNumberFromDirectories(parts.slice(formatOffset + 2, -1))
        ),
    };
}

function coverScore(file, albumKey) {
    const name = path.parse(file.filename).name.toLowerCase();
    const priority = COVER_NAMES.get(name);

    if (priority == null) {
        return null;
    }

    const directoryDepth = file.relative_path.split(/[\\/]+/).filter(Boolean).length
        - albumKey.split("/").length - 1;

    return priority * 100 + Math.max(0, directoryDepth);
}

function collectAlbums() {
    const groups = new Map();
    const covers = new Map();
    let audioFiles = 0;
    let skipped = 0;

    for (const file of getMusicFiles.all()) {
        const extension = (file.extension || path.extname(file.filename)).toLowerCase();
        const isAudio = AUDIO_EXTENSIONS.has(extension);
        const isImage = IMAGE_EXTENSIONS.has(extension);

        if (!isAudio && !isImage) {
            continue;
        }

        if (isAudio) {
            audioFiles++;
        }

        const parsed = parseMusicFile(file);

        if (!parsed) {
            if (isAudio) {
                skipped++;
                console.warn("Skipping unexpected music path: " + file.relative_path);
            }
            continue;
        }

        if (isAudio) {
            if (!groups.has(parsed.albumKey)) {
                groups.set(parsed.albumKey, {
                    key: parsed.albumKey,
                    folderArtist: parsed.folderArtist,
                    folderAlbum: parsed.folderAlbum,
                    tracks: [],
                });
            }

            groups.get(parsed.albumKey).tracks.push(parsed);
        } else {
            const score = coverScore(file, parsed.albumKey);
            const existing = covers.get(parsed.albumKey);

            if (score != null && (!existing || score < existing.score)) {
                covers.set(parsed.albumKey, { fileId: file.id, score });
            }
        }
    }

    for (const group of groups.values()) {
        group.coverFileId = covers.get(group.key)?.fileId ?? null;
    }

    return { groups, audioFiles, skipped };
}

function pictureMimeType(format) {
    const value = tagText(format).toLowerCase();

    if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(value)) {
        return value;
    }

    return {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
    }[value] || null;
}

function embeddedPicture(common, selectCover) {
    const picture = selectCover(common.picture);
    const mimeType = pictureMimeType(picture?.format);
    const size = picture?.data?.byteLength;

    if (!mimeType || !size || size > MAX_EMBEDDED_ART_BYTES) {
        return null;
    }

    return {
        mimeType,
        imageData: Buffer.from(picture.data),
    };
}

async function readAlbum(group, parseFile, selectCover, stats) {
    const tracks = [];
    let taggedAlbumTitle = "";
    let taggedAlbumArtists = [];
    let albumYear = null;
    let albumGenre = null;
    let artwork = null;

    for (const file of group.tracks) {
        let common = {};
        let format = {};

        try {
            const metadata = await parseFile(file.filePath, {
                duration: true,
                skipCovers: group.coverFileId != null || artwork != null,
            });
            common = metadata.common || {};
            format = metadata.format || {};
        } catch (error) {
            stats.metadataErrors++;
            console.warn("Could not read tags for " + file.relativePath + ": " + error.message);
        }

        taggedAlbumTitle ||= tagText(common.album);

        if (taggedAlbumArtists.length === 0) {
            taggedAlbumArtists = tagNames(common.albumartists, common.albumartist);
        }

        albumYear ??= releaseYear(common);
        albumGenre ||= primaryGenre(common);

        if (group.coverFileId == null && artwork == null) {
            artwork = embeddedPicture(common, selectCover);
        }

        const durationSeconds = format.duration;
        const durationMs = Number.isFinite(durationSeconds) && durationSeconds > 0
            ? Math.round(durationSeconds * 1000)
            : null;

        if (durationMs == null) {
            stats.missingDurations++;
        }

        tracks.push({
            fileId: file.fileId,
            title: tagText(common.title) || file.title,
            trackNumber: positiveInteger(common.track?.no) ?? file.trackNumber,
            discNumber: positiveInteger(common.disk?.no) ?? file.discNumber,
            durationMs,
            releaseYear: releaseYear(common),
            genre: primaryGenre(common),
            artists: tagNames(common.artists, common.artist),
        });
    }

    return {
        title: taggedAlbumTitle || group.folderAlbum,
        artists: taggedAlbumArtists.length ? taggedAlbumArtists : [group.folderArtist],
        releaseYear: albumYear,
        genre: albumGenre,
        artwork,
        tracks,
    };
}

function ensureArtist(name) {
    insertArtist.run(name);
    return getArtist.get(name).id;
}

const saveAlbum = db.transaction((group, details, stats) => {
    const existingAlbum = getAlbumByKey.get(group.key);
    const artworkFileId = group.coverFileId;
    let albumId;

    if (existingAlbum) {
        albumId = existingAlbum.id;
        updateAlbum.run(
            details.title, details.releaseYear, details.genre, artworkFileId, albumId
        );
    } else {
        albumId = Number(insertAlbum.run(
            group.key, details.title, details.releaseYear, details.genre, artworkFileId
        ).lastInsertRowid);
        stats.albumsCreated++;
    }

    if (artworkFileId == null && details.artwork) {
        saveEmbeddedArtwork.run(
            albumId, details.artwork.mimeType, details.artwork.imageData
        );
    } else {
        deleteEmbeddedArtwork.run(albumId);
    }

    clearAlbumArtists.run(albumId);

    for (const name of details.artists) {
        linkAlbumArtist.run(albumId, ensureArtist(name));
    }

    for (const track of details.tracks) {
        const existingTrack = getTrackByFile.get(track.fileId);
        let trackId;

        if (existingTrack) {
            trackId = existingTrack.id;
            updateTrack.run(
                albumId, track.title, track.trackNumber, track.discNumber,
                track.durationMs, track.releaseYear, track.genre, trackId
            );
        } else {
            trackId = Number(insertTrack.run(
                track.fileId, albumId, track.title, track.trackNumber,
                track.discNumber, track.durationMs, track.releaseYear, track.genre
            ).lastInsertRowid);
            stats.tracksCreated++;
        }

        clearTrackArtists.run(trackId);

        for (const name of track.artists.length ? track.artists : [group.folderArtist]) {
            linkTrackArtist.run(trackId, ensureArtist(name));
        }

        stats.tracksIndexed++;
    }

    stats.albumsIndexed++;
});

async function runMusicIndexer() {
    // music-metadata is ESM; the rest of the server currently uses CommonJS.
    const { parseFile, selectCover } = await import("music-metadata");
    const { groups, audioFiles, skipped } = collectAlbums();
    const stats = {
        audioFiles,
        skipped,
        metadataErrors: 0,
        missingDurations: 0,
        albumsIndexed: 0,
        albumsCreated: 0,
        tracksIndexed: 0,
        tracksCreated: 0,
    };

    for (const group of groups.values()) {
        const details = await readAlbum(group, parseFile, selectCover, stats);
        saveAlbum(group, details, stats);
    }

    console.log("Audio files found: " + stats.audioFiles);
    console.log("Albums indexed: " + stats.albumsIndexed + " (" + stats.albumsCreated + " new)");
    console.log("Tracks indexed: " + stats.tracksIndexed + " (" + stats.tracksCreated + " new)");
    console.log("Audio files skipped: " + stats.skipped);
    console.log("Tag read errors: " + stats.metadataErrors);
    console.log("Tracks without duration: " + stats.missingDurations);

    return stats;
}

if (require.main === module) {
    runMusicIndexer().catch((error) => {
        console.error("Music index failed:", error);
        process.exitCode = 1;
    });
}

module.exports = {
    runMusicIndexer,
    parseMusicFile,
    trackDetails,
};
