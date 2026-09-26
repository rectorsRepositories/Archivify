const fs = require("node:fs");
const path = require("node:path");

const db = require("../db/database");
const { createIgdbClient } = require("./igdb");
require("../db/schema");

// Limit the first catalog pass to self-contained disc images. In particular,
// .bin files can be BIOS data or companions to a cue sheet, not games by name.
const GAME_EXTENSIONS = new Set([".iso", ".chd", ".cso", ".zso"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const getFiles = db.prepare(
    "SELECT id, path, relative_path, filename, extension FROM files " +
    "WHERE category = 'games' ORDER BY relative_path COLLATE NOCASE, id"
);
const saveGame = db.prepare(
    "INSERT INTO games (file_id, source_key, title, platform, release_year, genre, artwork_file_id, " +
    "igdb_id, igdb_cover_image_id, summary, igdb_url) " +
    "VALUES (@fileId, @sourceKey, @title, @platform, @releaseYear, @genre, @artworkFileId, " +
    "@igdbId, @igdbCoverImageId, @summary, @igdbUrl) " +
    "ON CONFLICT(source_key) DO UPDATE SET " +
    "file_id = excluded.file_id, title = excluded.title, platform = excluded.platform, " +
    "release_year = excluded.release_year, genre = excluded.genre, " +
    "artwork_file_id = excluded.artwork_file_id, igdb_id = excluded.igdb_id, " +
    "igdb_cover_image_id = excluded.igdb_cover_image_id, summary = excluded.summary, " +
    "igdb_url = excluded.igdb_url"
);
const getExisting = db.prepare(
    "SELECT igdb_id, igdb_cover_image_id, summary, igdb_url, release_year, genre " +
    "FROM games WHERE source_key = ?"
);

function cleanTitle(value) {
    return value.replace(/[\uF03A\uFF1A]/g, ":").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function text(value) {
    return typeof value === "string" ? value.trim() : "";
}

function parseGameFile(file) {
    const extension = (file.extension || path.extname(file.filename)).toLowerCase();
    if (!GAME_EXTENSIONS.has(extension)) return null;

    const parts = file.relative_path.split(/[\\/]+/).filter(Boolean);
    if (parts.length < 2 || parts.some((part) => /\bbios\b/i.test(part))) return null;

    const platform = cleanTitle(parts[0]);
    const title = cleanTitle(path.parse(file.filename).name);
    if (!platform || !title) return null;

    return {
        fileId: file.id,
        sourceKey: parts.join("/"),
        platform,
        title,
        stem: path.parse(file.filename).name,
        directory: parts.slice(0, -1).join("/").toLowerCase(),
        filePath: file.path,
    };
}

function sidecarMetadata(game) {
    const sidecarPath = path.join(path.dirname(game.filePath), game.stem + ".game.json");
    let metadata;
    try {
        metadata = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return {};
        console.warn("Could not read game metadata for " + game.sourceKey + ": " + error.message);
        return {};
    }
    if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") return {};
    return metadata;
}

function artworkId(game, images) {
    const candidates = images.get(game.directory + "/" + game.stem.toLowerCase());
    return candidates?.[0]?.id ?? null;
}

async function runGameIndexer() {
    const files = getFiles.all();
    const images = new Map();
    for (const file of files) {
        const extension = (file.extension || path.extname(file.filename)).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(extension)) continue;
        const parts = file.relative_path.split(/[\\/]+/).filter(Boolean);
        const key = parts.slice(0, -1).join("/").toLowerCase() + "/" + path.parse(file.filename).name.toLowerCase();
        if (!images.has(key)) images.set(key, []);
        images.get(key).push(file);
    }

    const clientId = process.env.IGDB_CLIENT_ID;
    const clientSecret = process.env.IGDB_CLIENT_SECRET;
    let igdb = null;
    if (clientId && clientSecret) {
        try {
            igdb = await createIgdbClient(clientId, clientSecret);
        } catch (error) {
            console.warn("IGDB unavailable: " + error.message);
        }
    } else if (clientId || clientSecret) {
        console.warn("IGDB requires both IGDB_CLIENT_ID and IGDB_CLIENT_SECRET.");
    }

    let indexed = 0;
    let enriched = 0;
    for (const file of files) {
        const game = parseGameFile(file);
        if (!game) continue;
        const metadata = sidecarMetadata(game);
        const existing = getExisting.get(game.sourceKey);
        let match = null;
        if (igdb && (!existing?.igdb_id || process.env.IGDB_REFRESH === "1")) {
            try {
                match = await igdb.lookup(text(metadata.title) || game.title, game.platform);
                if (match) enriched++;
            } catch (error) {
                console.warn("IGDB lookup failed for " + game.sourceKey + ": " + error.message);
            }
        }
        const year = Number(metadata.release_year);
        const igdbYear = match?.first_release_date
            ? new Date(match.first_release_date * 1000).getUTCFullYear()
            : null;
        saveGame.run({
            fileId: game.fileId,
            sourceKey: game.sourceKey,
            title: text(metadata.title) || game.title,
            platform: text(metadata.platform) || game.platform,
            releaseYear: Number.isInteger(year) && year >= 1000 && year <= 9999
                ? year : igdbYear || existing?.release_year || null,
            genre: text(metadata.genre) || match?.genres?.[0]?.name || existing?.genre || null,
            artworkFileId: artworkId(game, images),
            igdbId: match?.id || existing?.igdb_id || null,
            igdbCoverImageId: match?.cover?.image_id || existing?.igdb_cover_image_id || null,
            summary: text(match?.summary) || existing?.summary || null,
            igdbUrl: text(match?.url) || existing?.igdb_url || null,
        });
        indexed++;
    }
    console.log("Games indexed: " + indexed + "; IGDB matches: " + enriched);
    return { indexed, enriched };
}

if (require.main === module) {
    runGameIndexer().catch((error) => {
        console.error("Game index failed:", error);
        process.exitCode = 1;
    });
}

module.exports = { runGameIndexer, parseGameFile };
