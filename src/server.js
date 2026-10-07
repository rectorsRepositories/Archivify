const http = require("node:http");

const db = require("./db/database");
require("./db/schema");

const { HttpError, sendJson, sendError, parseInteger } = require("./http");
const { routeMusic } = require("./routes/music");
const { routeGames } = require("./routes/games");
const { routeFiles } = require("./routes/files");
const { routeDownloads } = require("./routes/downloads");
const healthQuery = db.prepare("SELECT 1");

/**
 * Create the API server, dispatching GET/HEAD routes and formatting errors.
 * @returns {import('node:http').Server} Server ready to listen.
 */
function createServer() {
    return http.createServer(async (req, res) => {
        try {
            if (req.method !== "GET" && req.method !== "HEAD") {
                res.setHeader("Allow", "GET, HEAD");
                throw new HttpError(405, "method_not_allowed", "Only GET and HEAD are supported.");
            }

            const url = new URL(req.url || "/", "http://localhost");

            if (url.pathname === "/api/v1/health") {
                healthQuery.get();
                sendJson(req, res, 200, { status: "ok" });
                return;
            }

            if (await routeMusic(req, res, url)) {
                return;
            }

            if (routeGames(req, res, url)) {
                return;
            }

            if (routeFiles(req, res, url)) {
                return;
            }

            if (await routeDownloads(req, res, url)) {
                return;
            }

            throw new HttpError(404, "not_found", "Endpoint not found.");
        } catch (error) {
            sendError(req, res, error);
        }
    });
}

/**
 * Listen on HOST/PORT (default 127.0.0.1:3000).
 * @returns {import('node:http').Server} Server on which listening has been requested.
 * @throws {HttpError} When PORT is invalid.
 */
function startServer() {
    const port = parseInteger(process.env.PORT || "3000", "PORT", 1, 65535);
    const host = process.env.HOST || "127.0.0.1";
    const server = createServer();

    server.on("error", (error) => {
        console.error("Could not start archive server:", error);
        process.exitCode = 1;
    });

    server.listen(port, host, () => {
        console.log("Archive API listening on http://" + host + ":" + port + "/api/v1");
    });

    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = { createServer, startServer };
