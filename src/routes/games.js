const { HttpError, sendJson, sendList, parseId, parseInteger, pagination, textFilter } = require("../http");
const games = require("../services/games");

/**
 * Serve game listings, facets, and details.
 * @param {import('node:http').IncomingMessage} req Request.
 * @param {import('node:http').ServerResponse} res Response.
 * @param {URL} url Parsed request URL.
 * @returns {boolean} Whether this route handled the path.
 * @throws {HttpError} For invalid filters or a missing game ID.
 */
function routeGames(req, res, url) {
    if (url.pathname === "/api/v1/games/facets") {
        sendJson(req, res, 200, { data: games.gameFacets() });
        return true;
    }

    if (url.pathname === "/api/v1/games") {
        const params = url.searchParams;
        const page = pagination(params);
        const sort = params.get("sort") || "title";
        if (!["title", "newest", "oldest"].includes(sort)) {
            throw new HttpError(400, "invalid_parameter", "Invalid game sort order.");
        }
        const result = games.listGames({
            q: textFilter(params, "q"),
            platform: textFilter(params, "platform"),
            genre: textFilter(params, "genre"),
            year: params.has("year") ? parseInteger(params.get("year"), "year", 1000, 9999) : null,
            sort,
        }, page);
        sendList(req, res, result, page);
        return true;
    }

    const match = /^\/api\/v1\/games\/(\d+)$/.exec(url.pathname);
    if (!match) return false;
    const game = games.getGame(parseId(match[1]));
    if (!game) throw new HttpError(404, "not_found", "Game not found.");
    sendJson(req, res, 200, { data: game });
    return true;
}

module.exports = { routeGames };
