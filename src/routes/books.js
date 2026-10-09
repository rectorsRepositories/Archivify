const { HttpError, sendJson, sendList, parseId, parseInteger, pagination, textFilter } = require("../http");
const books = require("../services/books");
const { sendIndexedFile } = require("./downloads");

/**
 * Serve book metadata, cached artwork, inline EPUBs, and format-specific downloads.
 * @param {import('node:http').IncomingMessage} req GET/HEAD request.
 * @param {import('node:http').ServerResponse} res Response.
 * @param {URL} url Parsed request URL.
 * @returns {Promise<boolean>} Whether a books route handled the request.
 * @throws {HttpError} For invalid input, missing books, or unavailable formats.
 */
async function routeBooks(req, res, url) {
    if (url.pathname === "/api/v1/books/facets") {
        sendJson(req, res, 200, { data: books.bookFacets() });
        return true;
    }
    if (url.pathname === "/api/v1/books") {
        const params = url.searchParams;
        const page = pagination(params);
        const sort = params.get("sort") || "title";
        const format = params.has("format") ? params.get("format") : null;
        if (!["title", "newest", "oldest", "added"].includes(sort)) throw new HttpError(400, "invalid_parameter", "Invalid book sort order.");
        if (format !== null && !["epub", "txt"].includes(format)) throw new HttpError(400, "invalid_parameter", "Book format must be epub or txt.");
        const result = books.listBooks({ q: textFilter(params, "q"), author: textFilter(params, "author"),
            language: textFilter(params, "language"), subject: textFilter(params, "subject"),
            year: params.has("year") ? parseInteger(params.get("year"), "year", 1, 9999) : null,
            format, sort }, page);
        sendList(req, res, result, page);
        return true;
    }
    const match = /^\/api\/v1\/books\/(\d+)(?:\/(artwork|content|download))?$/.exec(url.pathname);
    if (!match) return false;
    const id = parseId(match[1]);
    const book = books.getBook(id);
    if (!book) throw new HttpError(404, "not_found", "Book not found.");
    if (!match[2]) {
        sendJson(req, res, 200, { data: book });
    } else if (match[2] === "artwork") {
        const cover = books.bookArtwork(id);
        if (!cover) throw new HttpError(404, "not_found", "Book artwork not found.");
        const etag = '"' + cover.checksum + '"';
        const headers = { "Content-Type": cover.mime_type, "Content-Length": cover.image_data.length,
            "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache", ETag: etag };
        if (req.headers["if-none-match"]?.split(",").some((value) => [etag, "W/" + etag, "*"].includes(value.trim()))) {
            delete headers["Content-Length"];
            res.writeHead(304, headers);
            res.end();
        } else {
            res.writeHead(200, headers);
            res.end(req.method === "HEAD" ? undefined : cover.image_data);
        }
    } else {
        const format = match[2] === "content" ? "epub" : url.searchParams.has("format")
            ? url.searchParams.get("format") : book.formats[0]?.format || "epub";
        if (!["epub", "txt"].includes(format)) throw new HttpError(400, "invalid_parameter", "Book format must be epub or txt.");
        const file = books.bookFiles(id).find((value) => value.format === format);
        if (!file) throw new HttpError(404, "format_unavailable", "The requested book format is unavailable.");
        await sendIndexedFile(req, res, file, match[2] === "download");
    }
    return true;
}

module.exports = { routeBooks };
