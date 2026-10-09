const fs = require("node:fs");
const path = require("node:path");

const db = require("../db/database");
const { createIgdbClient } = require("./igdb");
const { discoverGameSets } = require("./gameSets");
require("../db/schema");

// Standalone formats become one-file discs. Manifests and their referenced
// tracks are assembled into complete game sets by gameSets.js.
const GAME_EXTENSIONS = new Set([
    ".iso", ".chd", ".cso", ".zso", ".ciso", ".gcm", ".rvz", ".wbfs", ".cdi", ".pbp",
    ".nes", ".fds", ".unf", ".unif", ".sfc", ".smc", ".n64", ".v64", ".z64",
    ".gb", ".gbc", ".gba", ".nds", ".3ds", ".cia", ".xci", ".nsp", ".wud", ".wux",
    ".sms", ".gg", ".sg", ".md", ".smd", ".gen", ".32x", ".pce", ".sgx",
    ".a26", ".a52", ".a78", ".lnx", ".j64", ".ngp", ".ngc", ".ws", ".wsc",
]);

for (const value of (process.env.GAME_EXTRA_EXTENSIONS || "").split(/[\s,]+/).filter(Boolean)) {
    const extension = value.replace(/^\./, "").toLowerCase();
    if (!/^[a-z0-9]+$/.test(extension)) {
        throw new Error("Invalid GAME_EXTRA_EXTENSIONS entry: " + value);
    }
    GAME_EXTENSIONS.add("." + extension);
}
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/**
 * @typedef {object} GameMetadata Optional fields from a neighboring .game.json file.
 * @property {unknown} [title] Nonempty strings override the display title.
 * @property {unknown} [platform] Nonempty strings override the platform and IGDB query.
 * @property {unknown} [release_year] Values converting to a four-digit integer override the year.
 * @property {unknown} [genre] Nonempty strings override the genre.
 * @property {unknown} [discs] Optional ordered entry file paths for an unusual multi-disc layout.
 */

/**
 * @typedef {object} ParsedGame
 * @property {number} fileId Indexed file ID.
 * @property {string} sourceKey Slash-separated path relative to Games.
 * @property {string} platform Platform inferred from the first directory.
 * @property {string} title Title inferred from the filename.
 * @property {string} stem Filename without extension.
 * @property {string} directory Lowercase parent directory for artwork matching.
 * @property {string} filePath Indexed absolute path for sidecar lookup.
 */

/**
 * @typedef {object} GameIndexResult
 * @property {number} indexed Game rows inserted or updated.
 * @property {number} enriched Successful IGDB matches during this run.
 */

const getFiles = db.prepare(
    "SELECT id, path, relative_path, filename, extension, category FROM files " +
    "WHERE category = 'games' ORDER BY relative_path COLLATE NOCASE, id"
);
const saveGame = db.prepare(
    "INSERT INTO games (file_id, source_key, title, platform, release_year, genre, artwork_file_id, " +
    "igdb_id, igdb_cover_image_id, summary, igdb_url, expected_file_count, expected_disc_count) " +
    "VALUES (@fileId, @sourceKey, @title, @platform, @releaseYear, @genre, @artworkFileId, " +
    "@igdbId, @igdbCoverImageId, @summary, @igdbUrl, @fileCount, @discCount) " +
    "ON CONFLICT(source_key) DO UPDATE SET " +
    "file_id = excluded.file_id, title = excluded.title, platform = excluded.platform, " +
    "release_year = excluded.release_year, genre = excluded.genre, " +
    "artwork_file_id = excluded.artwork_file_id, igdb_id = excluded.igdb_id, " +
    "igdb_cover_image_id = excluded.igdb_cover_image_id, summary = excluded.summary, " +
    "igdb_url = excluded.igdb_url, expected_file_count = excluded.expected_file_count, " +
    "expected_disc_count = excluded.expected_disc_count"
);
const getExisting = db.prepare(
    "SELECT igdb_id, igdb_cover_image_id, summary, igdb_url, release_year, genre " +
    "FROM games WHERE source_key = ?"
);
const getGameId = db.prepare("SELECT id FROM games WHERE source_key = ?");
const deleteGameFiles = db.prepare("DELETE FROM game_files WHERE game_id = ?");
const addGameFile = db.prepare(
    "INSERT INTO game_files (game_id, file_id, disc_number, role) VALUES (?, ?, ?, ?)"
);
const saveGameSet = db.transaction((values, members) => {
    saveGame.run(values);
    const gameId = getGameId.get(values.sourceKey).id;
    deleteGameFiles.run(gameId);
    for (const member of members) {
        addGameFile.run(gameId, member.file.id, member.discNumber, member.role);
    }
});

function cleanTitle(value) {
    return value.replace(/[\uF03A\uFF1A]/g, ":").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Remove recognized ROM release tags while preserving meaningful title text.
 * @param {string} stem Filename without extension.
 * @returns {string} Normalized display title.
 */
function gameTitleFromStem(stem) {
    let title = stem;
    // ROM sets put release information at the end of the filename. Remove only
    // recognized tags so a title with meaningful parentheses stays intact.
    const releaseTag = /\s*(?:\(([^()]*)\)|\[([^\[\]]*)\])$/;
    const region = /^(?:USA|Europe|Japan|World|Australia|Asia|Brazil|Canada|China|France|Germany|Italy|Korea|Netherlands|Russia|Spain|Taiwan|UK)(?:\s*,\s*(?:USA|Europe|Japan|World|Australia|Asia|Brazil|Canada|China|France|Germany|Italy|Korea|Netherlands|Russia|Spain|Taiwan|UK))*$/i;
    const languages = /^(?:En|Fr|Es|De|It|Ja|Ko|Zh|Pt|Ru|Nl|Sv|Da|No|Fi)(?:\s*,\s*(?:En|Fr|Es|De|It|Ja|Ko|Zh|Pt|Ru|Nl|Sv|Da|No|Fi))*$/i;
    const revision = /^(?:Rev(?:ision)?\s*[a-z0-9.]+|v\d+(?:\.\d+)*|Disc\s*\d+(?:\s*of\s*\d+)?|Disk\s*\d+(?:\s*of\s*\d+)?)$/i;
    while (true) {
        const match = title.match(releaseTag);
        if (!match) break;
        const tag = (match[1] ?? match[2]).trim();
        if (!region.test(tag) && !languages.test(tag) && !revision.test(tag) && tag !== "!") break;
        title = title.slice(0, match.index);
    }
    title = cleanTitle(title || stem);
    // Some dumps move a leading article after the name and use a dash before
    // the subtitle, while catalogues put the article first and use a colon.
    return title.replace(/^(.+), (The|A|An) - (.+)$/i,
        (_, name, article, subtitle) => `${article} ${name}: ${subtitle}`);
}

function text(value) {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * Accept standalone game formats below a platform directory, excluding BIOS paths.
 * @param {{id: number, path: string, relative_path: string, filename: string, extension: string|null}} file Indexed games-category file.
 * @returns {ParsedGame|null} Parsed game or null for support and unrecognized files.
 */
function parseGameFile(file) {
    const extension = (file.extension || path.extname(file.filename)).toLowerCase();
    if (!GAME_EXTENSIONS.has(extension)) return null;

    const parts = file.relative_path.split(/[\\/]+/).filter(Boolean);
    if (parts.length < 2 || parts.some((part) => /\bbios\b/i.test(part))) return null;

    const platform = cleanTitle(parts[0]);
    const title = gameTitleFromStem(path.parse(file.filename).name);
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

/**
 * Read optional neighboring metadata; missing, malformed, or unreadable files yield {}.
 * @param {ParsedGame} game Parsed game and sidecar location.
 * @returns {GameMetadata} Parsed overrides when the JSON root is an object.
 */
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

/**
 * Find the first indexed image with the game's stem in the same directory.
 * @param {ParsedGame} game Game to match.
 * @param {Map<string, Array<{id: number}>>} images Images keyed by lowercase directory and stem.
 * @returns {number|null} Indexed artwork file ID, if present.
 */
function artworkId(game, images) {
    const candidates = images.get(game.directory + "/" + game.stem.toLowerCase());
    if (candidates?.length) return candidates[0].id;
    const firstDisc = game.files.find((member) => member.role === "entry");
    if (!firstDisc || firstDisc.file.id === game.fileId) return null;
    const stem = path.parse(firstDisc.file.filename).name.toLowerCase();
    const directory = firstDisc.file.relative_path.split(/[\\/]+/).slice(0, -1).join("/").toLowerCase();
    return images.get(directory + "/" + stem)?.[0]?.id ?? null;
}

/**
 * Upsert recognized games from indexed files, applying sidecar overrides first.
 * Existing IGDB fields survive missing matches; lookups are retried for missing IDs
 * or covers and when IGDB_REFRESH=1. Lookup failures are logged per game.
 * @returns {Promise<GameIndexResult>} Counts of saved games and IGDB matches.
 */
async function runGameIndexer() {
    const files = getFiles.all();
    const games = discoverGameSets(files, parseGameFile);
    const currentKeys = new Set(games.map((game) => game.sourceKey));
    const oldByFile = db.prepare("SELECT id FROM games WHERE file_id = ?");
    const oldByKey = db.prepare("SELECT id FROM games WHERE source_key = ?");
    const moveGame = db.prepare("UPDATE games SET source_key = ?, file_id = ? WHERE id = ?");
    for (const game of games) {
        if (oldByKey.get(game.sourceKey)) continue;
        const firstDisc = game.files.find((member) => member.role === "entry");
        const old = firstDisc && oldByFile.get(firstDisc.file.id);
        if (old) moveGame.run(game.sourceKey, game.fileId, old.id);
    }
    const deleteGame = db.prepare("DELETE FROM games WHERE id = ?");
    for (const old of db.prepare("SELECT id, source_key FROM games").all()) {
        if (!currentKeys.has(old.source_key)) deleteGame.run(old.id);
    }
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
    for (const game of games) {
        const metadata = sidecarMetadata(game);
        const existing = getExisting.get(game.sourceKey);
        let match = null;
        if (igdb && (!existing?.igdb_id || !existing?.igdb_cover_image_id || process.env.IGDB_REFRESH === "1")) {
            try {
                match = await igdb.lookup(text(metadata.title) || game.title, text(metadata.platform) || game.platform);
                if (match) enriched++;
            } catch (error) {
                console.warn("IGDB lookup failed for " + game.sourceKey + ": " + error.message);
            }
        }
        const year = Number(metadata.release_year);
        const igdbYear = match?.first_release_date
            ? new Date(match.first_release_date * 1000).getUTCFullYear()
            : null;
        saveGameSet({
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
            fileCount: game.files.length,
            discCount: game.discCount,
        }, game.files);
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

module.exports = { runGameIndexer, parseGameFile, gameTitleFromStem };
