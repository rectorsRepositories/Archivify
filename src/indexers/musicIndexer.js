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

/**
 * @typedef {object} IndexedMusicFile
 * @property {number} id File table ID.
 * @property {string} path Absolute path used to read tags.
 * @property {string} relative_path Path below Music.
 * @property {string} filename Basename.
 * @property {string|null} extension Indexed extension.
 */

/**
 * @typedef {object} ParsedMusicFile
 * @property {string} albumKey Slash-separated album directory relative to Music.
 * @property {string} folderArtist Artist inferred from the directory.
 * @property {string} folderAlbum Album inferred from the directory.
 * @property {number} fileId File table ID.
 * @property {string} filePath Absolute path.
 * @property {string} relativePath Path below Music.
 * @property {string} title Filename-derived title.
 * @property {number|null} trackNumber Filename-derived track number.
 * @property {number|null} discNumber Directory- or filename-derived disc number.
 */

/**
 * @typedef {object} AlbumGroup
 * @property {string} key Album source key.
 * @property {string} folderArtist Directory-derived artist.
 * @property {string} folderAlbum Directory-derived album title.
 * @property {ParsedMusicFile[]} tracks Audio files in the album.
 * @property {number|null} coverFileId Preferred indexed cover image ID.
 */

/**
 * @typedef {object} AlbumDetails
 * @property {string} title Tag-derived or directory-derived album title.
 * @property {string[]} artists Tag-derived or directory-derived album artists.
 * @property {number|null} releaseYear Album release year.
 * @property {string|null} genre Album genre.
 * @property {{mimeType: string, imageData: Buffer}|null} artwork Embedded cover when no indexed cover is selected.
 * @property {Array<{fileId: number, title: string, trackNumber: number|null, discNumber: number|null, durationMs: number|null, releaseYear: number|null, genre: string|null, artists: string[]}>} tracks Parsed tracks.
 */

/**
 * @typedef {object} MusicIndexStats
 * @property {number} audioFiles Recognized audio files found.
 * @property {number} skipped Audio files outside the expected directory layout.
 * @property {number} metadataErrors Tag reads that failed.
 * @property {number} missingDurations Tracks without a parsed duration.
 * @property {number} albumsIndexed Albums saved this run.
 * @property {number} albumsCreated Newly inserted albums.
 * @property {number} albumsRemoved Orphaned albums deleted.
 * @property {number} tracksIndexed Tracks saved this run.
 * @property {number} tracksCreated Newly inserted tracks.
 * @property {number} artistsRemoved Orphaned artists deleted.
 */

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

/**
 * Delete albums without tracks and artists without album or track links.
 * @returns {{albumsRemoved: number, artistsRemoved: number}} Deleted row counts.
 */
const reconcileOrphans = db.transaction(() => {
    const albumsRemoved = db.prepare(
        "DELETE FROM albums WHERE NOT EXISTS " +
        "(SELECT 1 FROM tracks WHERE tracks.album_id = albums.id)"
    ).run().changes;
    const artistsRemoved = db.prepare(
        "DELETE FROM artists WHERE NOT EXISTS " +
        "(SELECT 1 FROM album_artists WHERE album_artists.artist_id = artists.id) " +
        "AND NOT EXISTS " +
        "(SELECT 1 FROM track_artists WHERE track_artists.artist_id = artists.id)"
    ).run().changes;
    return { albumsRemoved, artistsRemoved };
});

function displayName(value) {
    return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function tagText(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Deduplicate plural artist tags case-insensitively, falling back to a singular tag.
 * @param {unknown} plural Multi-value artist tag.
 * @param {unknown} singular Single artist tag.
 * @returns {string[]} Nonempty normalized artist names.
 */
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

/**
 * Prefer a valid year tag, then the leading year in release-date or date tags.
 * @param {object} common Parsed common music tags.
 * @returns {number|null} Release year, if found.
 */
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

/**
 * Select the first nonempty genre tag.
 * @param {object} common Parsed common music tags.
 * @returns {string|null} Primary genre, if present.
 */
function primaryGenre(common) {
    const genres = Array.isArray(common.genre) ? common.genre : [common.genre];
    return genres.map(tagText).find(Boolean) || null;
}

/**
 * Find a CD, disc, or disk number in track subdirectories.
 * @param {string[]} directories Folders below the album directory.
 * @returns {number|null} First recognized disc number.
 */
function discNumberFromDirectories(directories) {
    for (const directory of directories) {
        const match = /^(?:cd|disc|disk)[\s._-]*(\d{1,2})$/i.exec(directory);

        if (match) {
            return Number(match[1]);
        }
    }

    return null;
}

/**
 * Infer title and track/disc numbers from common filename prefixes.
 * @param {string} filename Audio filename.
 * @param {number|null} directoryDiscNumber Disc number inferred from parent folders.
 * @returns {{title: string, trackNumber: number|null, discNumber: number|null}} Filename fallback metadata.
 */
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

/**
 * Parse artist/album/track folders, optionally preceded by a format directory.
 * @param {IndexedMusicFile} file Indexed Music file.
 * @returns {ParsedMusicFile|null} Parsed path or null for an unexpected layout.
 */
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

/**
 * Rank named album covers, preferring cover/folder/front/album and shallower paths.
 * @param {IndexedMusicFile} file Indexed image.
 * @param {string} albumKey Album directory key.
 * @returns {number|null} Lower is better; null means the name is not recognized.
 */
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

/**
 * Group indexed audio files by album and select one indexed cover per group.
 * @returns {{groups: Map<string, AlbumGroup>, audioFiles: number, skipped: number}} Album groups and scan counts.
 */
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

/**
 * Accept supported picture MIME types and common abbreviated formats.
 * @param {unknown} format Picture format tag.
 * @returns {string|null} MIME type, if supported.
 */
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

/**
 * Accept supported embedded art up to 10 MiB when no indexed cover is selected.
 * @param {object} common Parsed common music tags.
 * @param {Function} selectCover Metadata library cover selector.
 * @returns {{mimeType: string, imageData: Buffer}|null} Storable picture, if present.
 */
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

/**
 * Read each track's tags, falling back to folder and filename data on missing tags.
 * Tag failures increment stats and do not abort the album.
 * @param {AlbumGroup} group Files and cover selected for one album.
 * @param {Function} parseFile Metadata library file parser.
 * @param {Function} selectCover Metadata library cover selector.
 * @param {MusicIndexStats} stats Counters updated in place.
 * @returns {Promise<AlbumDetails>} Album and track metadata ready for persistence.
 */
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

/**
 * Insert an artist if needed and return its database ID.
 * @param {string} name Artist name.
 * @returns {number} Artist ID.
 */
function ensureArtist(name) {
    insertArtist.run(name);
    return getArtist.get(name).id;
}

/**
 * Upsert an album, its tracks, artists, and selected artwork atomically.
 * Existing artist links are replaced; embedded artwork is removed when a file cover wins.
 * @param {AlbumGroup} group Album source and cover selection.
 * @param {AlbumDetails} details Parsed album and track metadata.
 * @param {MusicIndexStats} stats Counters updated in place.
 * @returns {void}
 */
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

/**
 * Index recognized audio from file rows, then remove albums and artists left orphaned.
 * Tag failures use path fallbacks; database failures propagate to the caller.
 * @param {{parseFile: Function, selectCover: Function}} [metadataReader] Optional parser for deterministic runs.
 * @returns {Promise<MusicIndexStats>} Index, metadata, and cleanup counts.
 */
async function runMusicIndexer(metadataReader) {
    // Accept a reader so indexing behavior can be exercised with deterministic
    // metadata; CLI runs still load the real ESM parser on demand.
    const { parseFile, selectCover } = metadataReader || await import("music-metadata");
    const { groups, audioFiles, skipped } = collectAlbums();
    const stats = {
        audioFiles,
        skipped,
        metadataErrors: 0,
        missingDurations: 0,
        albumsIndexed: 0,
        albumsCreated: 0,
        albumsRemoved: 0,
        tracksIndexed: 0,
        tracksCreated: 0,
        artistsRemoved: 0,
    };

    for (const group of groups.values()) {
        const details = await readAlbum(group, parseFile, selectCover, stats);
        saveAlbum(group, details, stats);
    }

    // Reconcile only after all current files have been linked. A renamed track
    // can replace the sole old track without changing its album's source key.
    const removed = reconcileOrphans();
    stats.albumsRemoved = removed.albumsRemoved;
    stats.artistsRemoved = removed.artistsRemoved;

    console.log("Audio files found: " + stats.audioFiles);
    console.log("Albums indexed: " + stats.albumsIndexed + " (" + stats.albumsCreated + " new)");
    console.log("Tracks indexed: " + stats.tracksIndexed + " (" + stats.tracksCreated + " new)");
    console.log("Empty albums removed: " + stats.albumsRemoved);
    console.log("Unused artists removed: " + stats.artistsRemoved);
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
