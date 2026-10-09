const fs = require("node:fs");
const path = require("node:path");
const { resolveArchiveFile } = require("../archivePaths");

const MANIFEST_EXTENSIONS = new Set([".cue", ".gdi", ".ccd", ".mds"]);
const DISC_TAG = /^(?:disc|disk)\s*(\d+)(?:\s*of\s*(\d+))?$/i;

function slash(value) {
    return value.replace(/\\/g, "/");
}

function discDetails(stem) {
    const tags = [];
    let base = stem;
    const suffix = /\s*(\(([^()]*)\)|\[([^\[\]]*)\])$/;
    while (true) {
        const match = base.match(suffix);
        if (!match) break;
        tags.unshift({ full: match[0], value: (match[2] ?? match[3]).trim() });
        base = base.slice(0, match.index);
    }
    const disc = tags.find((tag) => DISC_TAG.test(tag.value));
    const match = disc?.value.match(DISC_TAG);
    const number = match ? Number(match[1]) : null;
    const total = match?.[2] ? Number(match[2]) : null;
    const groupStem = (base + tags.filter((tag) => tag !== disc).map((tag) => tag.full).join(""))
        .replace(/\s+/g, " ").trim().toLowerCase();
    return { number: Number.isSafeInteger(number) && number > 0 ? number : null,
        total: Number.isSafeInteger(total) && total > 0 ? total : null, groupStem };
}

function hasWrongDiscTotal(discs) {
    return discs.some((disc) => {
        const total = discDetails(path.parse(disc.file.filename).name).total;
        return total != null && total !== discs.length;
    });
}

function fileLookup(files) {
    const exact = new Map();
    const folded = new Map();
    for (const file of files) {
        const key = slash(file.relative_path);
        exact.set(key, file);
        const lower = key.toLowerCase();
        folded.set(lower, folded.has(lower) ? null : file);
    }
    return (owner, reference) => {
        const value = slash(reference.trim());
        if (!value || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value)) return null;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(slash(owner.relative_path)), value));
        const platform = slash(owner.relative_path).split("/")[0];
        if (!target.startsWith(platform + "/") || target.split("/").includes("..")) return null;
        return exact.get(target) || folded.get(target.toLowerCase()) || null;
    };
}

function readManifest(file) {
    const location = resolveArchiveFile(file);
    if (!location) throw new Error("File is outside the archive");
    const stats = fs.statSync(location);
    if (stats.size > 1024 * 1024) throw new Error("Manifest exceeds 1 MiB");
    return fs.readFileSync(location, "utf8").replace(/^\uFEFF/, "");
}

function manifestReferences(file, resolve) {
    const extension = file.extension?.toLowerCase();
    let references;
    if (extension === ".ccd" || extension === ".mds") {
        const stem = slash(file.relative_path).slice(0, -extension.length);
        const required = resolve(file, path.posix.basename(stem) + (extension === ".ccd" ? ".img" : ".mdf"));
        if (!required) throw new Error("Missing companion image");
        references = [required];
        if (extension === ".ccd") {
            const sub = resolve(file, path.posix.basename(stem) + ".sub");
            if (sub) references.push(sub);
        }
    } else {
        const content = readManifest(file);
        const names = [];
        if (extension === ".cue") {
            for (const line of content.split(/\r?\n/)) {
                const match = /^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+\S+/i.exec(line);
                if (match) names.push(match[1] || match[2]);
            }
        } else if (extension === ".gdi") {
            for (const line of content.split(/\r?\n/).slice(1)) {
                const match = /^\s*\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))\s+\d+/i.exec(line);
                if (match) names.push(match[1] || match[2]);
            }
        }
        if (!names.length) throw new Error("No referenced tracks");
        references = names.map((name) => {
            const target = resolve(file, name);
            if (!target) throw new Error("Missing or unsafe track: " + name);
            return target;
        });
    }
    return [...new Map(references.map((item) => [item.id, item])).values()];
}

function discoverGameSets(files, parseGameFile) {
    const resolve = fileLookup(files);
    const entries = new Map();
    const used = new Set();
    for (const file of files) {
        const extension = file.extension?.toLowerCase();
        if (extension !== ".m3u" && !MANIFEST_EXTENSIONS.has(extension) && !parseGameFile(file)) continue;
        const parts = slash(file.relative_path).split("/");
        if (parts.length < 2 || parts.some((part) => /\bbios\b/i.test(part))) continue;
        try {
            const dependencies = MANIFEST_EXTENSIONS.has(extension) ? manifestReferences(file, resolve) : [];
            const sbi = resolve(file, path.parse(file.filename).name + ".sbi");
            if (sbi && !dependencies.some((item) => item.id === sbi.id)) dependencies.push(sbi);
            entries.set(file.id, { file, dependencies });
        } catch (error) {
            console.warn("Skipping incomplete game disc " + file.relative_path + ": " + error.message);
        }
    }

    function makeSet(entry, discs, playlist = null) {
        const representative = entry.file;
        const parsed = parseGameFile({ ...representative, extension: ".iso" });
        const members = [];
        const seen = new Set();
        function add(file, discNumber, role) {
            if (seen.has(file.id)) return;
            seen.add(file.id);
            members.push({ file, discNumber, role });
        }
        if (playlist) add(playlist, null, "playlist");
        discs.forEach((disc, index) => {
            const number = discs.length > 1 ? index + 1 : 1;
            add(disc.file, number, "entry");
            for (const dependency of disc.dependencies) add(dependency, number, "data");
        });
        return { ...parsed, fileId: representative.id, sourceKey: slash(representative.relative_path),
            files: members, discCount: discs.length };
    }

    const sets = [];
    for (const file of files) {
        if (file.extension?.toLowerCase() !== ".m3u") continue;
        const parts = slash(file.relative_path).split("/");
        if (parts.length < 2 || parts.some((part) => /\bbios\b/i.test(part))) continue;
        try {
            const lines = readManifest(file).split(/\r?\n/).map((line) => line.trim())
                .filter((line) => line && !line.startsWith("#"));
            if (!lines.length) throw new Error("Playlist has no discs");
            const discs = lines.map((line) => {
                const target = resolve(file, line);
                const entry = target && entries.get(target.id);
                if (!entry || target.extension?.toLowerCase() === ".m3u") {
                    throw new Error("Missing or unsupported disc: " + line);
                }
                return entry;
            });
            if (new Set(discs.map((disc) => disc.file.id)).size !== discs.length) {
                throw new Error("Playlist lists a disc more than once");
            }
            if (hasWrongDiscTotal(discs)) throw new Error("Playlist omits a declared disc");
            if (discs.some((disc) => used.has(disc.file.id))) throw new Error("Disc belongs to another playlist");
            const playlistEntry = { file, dependencies: [] };
            sets.push(makeSet(playlistEntry, discs, file));
            used.add(file.id);
            for (const disc of discs) used.add(disc.file.id);
        } catch (error) {
            console.warn("Skipping incomplete game playlist " + file.relative_path + ": " + error.message);
        }
    }

    for (const entry of entries.values()) {
        const file = entry.file;
        if (used.has(file.id) || file.extension?.toLowerCase() === ".m3u") continue;
        const location = resolveArchiveFile(file);
        if (!location) continue;
        let metadata;
        try {
            metadata = JSON.parse(fs.readFileSync(
                path.join(path.dirname(location), path.parse(file.filename).name + ".game.json"), "utf8"));
        } catch (_error) {
            continue;
        }
        if (!metadata || !Object.hasOwn(metadata, "discs")) continue;
        try {
            if (!Array.isArray(metadata.discs) || metadata.discs.length < 2 ||
                metadata.discs.some((item) => typeof item !== "string")) {
                throw new Error("discs must list at least two entry file paths");
            }
            const discs = metadata.discs.map((name) => {
                const target = resolve(file, name);
                const disc = target && entries.get(target.id);
                if (!disc || target.extension?.toLowerCase() === ".m3u" || used.has(target.id)) {
                    throw new Error("Missing or unavailable disc: " + name);
                }
                return disc;
            });
            if (discs[0].file.id !== file.id ||
                new Set(discs.map((disc) => disc.file.id)).size !== discs.length) {
                throw new Error("discs must start with this file and contain no duplicates");
            }
            if (hasWrongDiscTotal(discs)) throw new Error("discs omits a declared disc");
            sets.push(makeSet(entry, discs));
            for (const disc of discs) used.add(disc.file.id);
        } catch (error) {
            console.warn("Ignoring game disc override " + file.relative_path + ": " + error.message);
        }
    }

    const dependencyIds = new Set([...entries.values()].flatMap((entry) =>
        entry.dependencies.map((file) => file.id)));
    const candidates = [...entries.values()].filter((entry) =>
        !used.has(entry.file.id) && !dependencyIds.has(entry.file.id) &&
        entry.file.extension?.toLowerCase() !== ".m3u");
    const groups = new Map();
    for (const entry of candidates) {
        const stem = path.parse(entry.file.filename).name;
        const details = discDetails(stem);
        if (!details.number) continue;
        const directory = path.posix.dirname(slash(entry.file.relative_path)).toLowerCase();
        const key = directory + "/" + details.groupStem;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ entry, number: details.number, total: details.total });
    }
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        const numbers = group.map((item) => item.number);
        if (new Set(numbers).size !== group.length ||
            group.some((item) => item.total != null && item.total !== group.length) ||
            [...numbers].sort((a, b) => a - b).some((number, index) => number !== index + 1)) {
            console.warn("Ambiguous disc numbers for " + group[0].entry.file.relative_path);
            continue;
        }
        group.sort((a, b) => a.number - b.number);
        const discs = group.map((item) => item.entry);
        sets.push(makeSet(discs[0], discs));
        for (const disc of discs) used.add(disc.file.id);
    }
    for (const entry of candidates) {
        if (used.has(entry.file.id)) continue;
        if ((discDetails(path.parse(entry.file.filename).name).total ?? 1) > 1) {
            console.warn("Skipping incomplete declared disc set " + entry.file.relative_path);
            continue;
        }
        sets.push(makeSet(entry, [entry]));
    }
    return sets;
}

module.exports = { discoverGameSets, discDetails };
