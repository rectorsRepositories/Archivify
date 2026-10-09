const fs = require("node:fs");
const path = require("node:path");
const { HttpError } = require("../http");
const games = require("../services/games");
const { archiveRoot, resolveArchiveFile } = require("../archivePaths");
const { attachmentHeader, sendIndexedFile } = require("./downloads");

function safeFolder(title) {
    return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").trim() || "Game";
}

function archiveNames(files, title) {
    const paths = files.map((file) => file.relative_path.replace(/\\/g, "/").split("/"));
    const platform = paths[0]?.[0];
    if (!platform || paths.some((parts) => parts[0] !== platform)) {
        throw new HttpError(409, "game_incomplete", "Game files are not on one platform.");
    }
    let common = paths[0].slice(0, -1);
    for (const parts of paths.slice(1)) {
        let i = 0;
        while (i < common.length && common[i] === parts[i]) i++;
        common = common.slice(0, i);
    }
    if (!common.length) common = [platform];
    const used = new Set();
    const folder = safeFolder(title);
    return paths.map((parts) => {
        const inside = parts.slice(common.length);
        if (!inside.length || inside.some((part) => !part || part === "." || part === ".." ||
            /[\x00-\x1f]/.test(part))) {
            throw new HttpError(409, "game_incomplete", "Game has an unsafe archive path.");
        }
        const name = folder + "/" + inside.join("/");
        if (used.has(name.toLowerCase())) {
            throw new HttpError(409, "game_incomplete", "Game has duplicate archive paths.");
        }
        used.add(name.toLowerCase());
        return name;
    });
}

async function sendGameDownload(req, res, gameId) {
    const game = games.getGame(gameId);
    if (!game) throw new HttpError(404, "not_found", "Game not found.");
    const files = games.listGameFiles(gameId);
    if (!files.length) throw new HttpError(409, "game_incomplete", "Game has no indexed files.");
    if (!game.is_complete || files.length !== game.file_count) {
        throw new HttpError(409, "game_incomplete", "A required game file is no longer indexed.");
    }
    if (files.length === 1) {
        await sendIndexedFile(req, res, files[0], true);
        return;
    }

    const names = archiveNames(files, game.title);
    const root = await fs.promises.realpath(path.join(archiveRoot, "Games"));
    const archiveFiles = [];
    for (const file of files) {
        const location = resolveArchiveFile(file);
        if (!location) throw new HttpError(409, "game_incomplete", "A game file is unavailable.");
        try {
            const real = await fs.promises.realpath(location);
            const relative = path.relative(root, real);
            if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
                throw new HttpError(409, "game_incomplete", "A game file is outside the archive.");
            }
            if (!(await fs.promises.stat(real)).isFile()) {
                throw new HttpError(409, "game_incomplete", "A game file is unavailable.");
            }
            archiveFiles.push(real);
        } catch (error) {
            if (error instanceof HttpError) throw error;
            if (error.code === "ENOENT" || error.code === "ENOTDIR") {
                throw new HttpError(409, "game_incomplete", "A game file is unavailable.");
            }
            throw error;
        }
    }

    const ZipArchive = req.method === "HEAD" ? null : (await import("archiver")).ZipArchive;
    res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": attachmentHeader(safeFolder(game.title) + ".zip"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") {
        res.end();
        return;
    }
    const archive = new ZipArchive({ store: true });
    archive.on("warning", (error) => { console.error("Game download warning:", error); res.destroy(error); });
    archive.on("error", (error) => { console.error("Game download failed:", error); res.destroy(error); });
    res.on("close", () => { if (!res.writableEnded) archive.abort(); });
    archive.pipe(res);
    archiveFiles.forEach((location, index) => archive.file(location, { name: names[index] }));
    archive.finalize().catch((error) => { console.error("Game download failed:", error); res.destroy(error); });
}

module.exports = { sendGameDownload };
