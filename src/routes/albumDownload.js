const fs = require("node:fs");
const path = require("node:path");

const { HttpError } = require("../http");
const music = require("../services/music");
const { attachmentHeader } = require("./downloads");
const { resolveArchiveFile } = require("../archivePaths");

function safeSegment(value) {
    return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .replace(/[. ]+$/g, "").trim() || "untitled";
}

function uniqueEntryName(relativePath, usedNames) {
    const parts = relativePath.split("/").map(safeSegment);
    const filename = parts.pop();
    const extension = path.posix.extname(filename);
    const stem = filename.slice(0, filename.length - extension.length);
    const directory = parts.length ? parts.join("/") + "/" : "";
    let candidate = directory + filename;
    let suffix = 2;

    while (usedNames.has(candidate.toLowerCase())) {
        candidate = directory + stem + " (" + suffix++ + ")" + extension;
    }

    usedNames.add(candidate.toLowerCase());
    return candidate;
}

async function sendAlbumDownload(req, res, albumId) {
    const album = music.getAlbum(albumId);
    if (!album) {
        throw new HttpError(404, "not_found", "Album not found.");
    }

    const files = music.listAlbumFiles(album.source_key);
    if (files.length === 0) {
        throw new HttpError(404, "album_files_unavailable", "No indexed files were found for this album.");
    }

    const archiveFiles = [];
    for (const file of files) {
        const filePath = resolveArchiveFile(file);
        if (!filePath) {
            throw new HttpError(409, "album_incomplete", "An indexed album file is unavailable.");
        }
        try {
            const stats = await fs.promises.stat(filePath);
            if (!stats.isFile()) {
                throw new HttpError(409, "album_incomplete", "An indexed album file is unavailable.");
            }
            archiveFiles.push({ ...file, filePath });
        } catch (error) {
            if (error instanceof HttpError) throw error;
            if (error.code === "ENOENT" || error.code === "ENOTDIR") {
                throw new HttpError(409, "album_incomplete", "An indexed album file is unavailable.");
            }
            throw error;
        }
    }

    const ZipArchive = req.method === "HEAD" ? null : (await import("archiver")).ZipArchive;
    const folder = safeSegment(path.posix.basename(album.source_key));
    res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": attachmentHeader(folder + ".zip"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") {
        res.end();
        return;
    }

    const archive = new ZipArchive({ store: true });
    const usedNames = new Set();
    const prefix = album.source_key + "/";

    archive.on("warning", (error) => {
        console.error("Album download warning:", error);
        res.destroy(error);
    });
    archive.on("error", (error) => {
        console.error("Album download failed:", error);
        res.destroy(error);
    });
    res.on("close", () => {
        if (!res.writableEnded) archive.abort();
    });
    archive.pipe(res);

    for (const file of archiveFiles) {
        const relativePath = file.relative_path.replace(/\\/g, "/");
        const insideAlbum = relativePath.slice(prefix.length);
        const entryName = folder + "/" + uniqueEntryName(insideAlbum, usedNames);
        archive.file(file.filePath, { name: entryName });
    }

    archive.finalize().catch((error) => {
        console.error("Album download failed:", error);
        res.destroy(error);
    });
}

module.exports = { sendAlbumDownload };
