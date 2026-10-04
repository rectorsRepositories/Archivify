const fs = require("node:fs");
const path = require("node:path");

const { HttpError, parseId } = require("../http");
const { getFile } = require("../services/files");

const CONTENT_TYPES = {
    ".flac": "audio/flac",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".wav": "audio/wav",
    ".aif": "audio/aiff",
    ".aiff": "audio/aiff",
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
};

function contentType(file) {
    const extension = (file.extension || path.extname(file.filename)).toLowerCase();
    return CONTENT_TYPES[extension] || "application/octet-stream";
}

function parseRange(header, size) {
    if (!header) {
        return null;
    }

    const value = header.trim();
    // Only single byte ranges are implemented. HTTP permits ignoring an
    // unsupported range unit or a multipart request and sending the full file.
    if (!/^bytes=/i.test(value) || value.includes(",")) {
        return null;
    }

    const match = /^bytes=(\d*)-(\d*)$/i.exec(value);

    if (!match || (!match[1] && !match[2]) || size === 0) {
        return false;
    }

    let start;
    let end;

    if (!match[1]) {
        const suffixLength = Number(match[2]);

        if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) {
            return false;
        }

        start = Math.max(0, size - suffixLength);
        end = size - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : size - 1;

        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
            || start >= size || end < start) {
            return false;
        }

        end = Math.min(end, size - 1);
    }

    return { start, end };
}

function attachmentHeader(filename) {
    const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) =>
        "%" + character.charCodeAt(0).toString(16).toUpperCase()
    );

    return "attachment; filename=\"" + fallback + "\"; filename*=UTF-8''" + encoded;
}

async function sendIndexedFile(req, res, file, download = false) {
    let stats;

    try {
        stats = await fs.promises.stat(file.path);
    } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") {
            throw new HttpError(404, "file_unavailable", "The indexed file is unavailable.");
        }
        throw error;
    }

    if (!stats.isFile()) {
        throw new HttpError(404, "file_unavailable", "The indexed file is unavailable.");
    }

    const size = stats.size;
    // Range applies to GET. Without a response validator, If-Range cannot be
    // confirmed, so send the complete file in that case as well.
    const range = req.method === "GET" && !req.headers["if-range"]
        ? parseRange(req.headers.range, size)
        : null;

    if (range === false) {
        res.writeHead(416, {
            "Content-Range": "bytes */" + size,
            "Accept-Ranges": "bytes",
            "Content-Length": 0,
            "X-Content-Type-Options": "nosniff",
        });
        res.end();
        return;
    }

    const headers = {
        "Content-Type": contentType(file),
        "Content-Length": range ? range.end - range.start + 1 : size,
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
    };

    if (range) {
        headers["Content-Range"] = "bytes " + range.start + "-" + range.end + "/" + size;
    }

    if (download) {
        headers["Content-Disposition"] = attachmentHeader(file.filename);
    }

    res.writeHead(range ? 206 : 200, headers);

    if (req.method === "HEAD" || size === 0) {
        res.end();
        return;
    }

    const stream = fs.createReadStream(file.path, range || undefined);
    stream.on("error", (error) => {
        console.error(error);
        res.destroy(error);
    });
    stream.pipe(res);
}

async function routeDownloads(req, res, url) {
    const match = /^\/api\/v1\/files\/(\d+)\/(content|download)$/.exec(url.pathname);

    if (!match) {
        return false;
    }

    const file = getFile(parseId(match[1]));

    if (!file) {
        throw new HttpError(404, "not_found", "File not found.");
    }

    await sendIndexedFile(req, res, file, match[2] === "download");
    return true;
}

module.exports = {
    routeDownloads,
    sendIndexedFile,
    attachmentHeader,
};
