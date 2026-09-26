const {
    HttpError,
    sendJson,
    sendList,
    parseId,
    pagination,
    textFilter,
} = require("../http");
const {
    publicFile,
    listFiles,
    getFile,
    librarySummary,
} = require("../services/files");

function routeFiles(req, res, url) {
    if (url.pathname === "/api/v1/library/summary") {
        sendJson(req, res, 200, { data: librarySummary() });
        return true;
    }

    if (url.pathname === "/api/v1/files") {
        const page = pagination(url.searchParams);
        const result = listFiles({
            q: textFilter(url.searchParams, "q"),
            category: textFilter(url.searchParams, "category"),
            extension: textFilter(url.searchParams, "extension"),
            path: textFilter(url.searchParams, "path"),
        }, page);
        sendList(req, res, result, page);
        return true;
    }

    const match = /^\/api\/v1\/files\/(\d+)$/.exec(url.pathname);

    if (match) {
        const file = getFile(parseId(match[1]));

        if (!file) {
            throw new HttpError(404, "not_found", "File not found.");
        }

        sendJson(req, res, 200, { data: publicFile(file) });
        return true;
    }

    return false;
}

module.exports = { routeFiles };
