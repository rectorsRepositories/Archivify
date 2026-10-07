/** HTTP status and stable API error code carried to the response boundary. */
class HttpError extends Error {
    /**
     * @param {number} status HTTP status.
     * @param {string} code Machine-readable error code.
     * @param {string} message Public error message.
     */
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

/**
 * Send JSON without a body for HEAD requests.
 * @param {import('node:http').IncomingMessage} req Request.
 * @param {import('node:http').ServerResponse} res Response to finish.
 * @param {number} status HTTP status.
 * @param {unknown} payload JSON-serializable response body.
 * @returns {void}
 */
function sendJson(req, res, status, payload) {
    const body = Buffer.from(JSON.stringify(payload));
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": body.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });

    if (req.method === "HEAD") {
        res.end();
    } else {
        res.end(body);
    }
}

/**
 * Convert HttpError to a public response and hide unexpected error details.
 * A response already in progress is destroyed instead.
 * @param {import('node:http').IncomingMessage} req Request.
 * @param {import('node:http').ServerResponse} res Response.
 * @param {Error} error Error reaching the HTTP boundary.
 * @returns {void}
 */
function sendError(req, res, error) {
    if (res.headersSent) {
        res.destroy(error);
        return;
    }

    if (error instanceof HttpError) {
        sendJson(req, res, error.status, {
            error: { code: error.code, message: error.message },
        });
        return;
    }

    console.error(error);
    sendJson(req, res, 500, {
        error: { code: "internal_error", message: "An unexpected server error occurred." },
    });
}

/**
 * Parse a decimal URL or environment value within inclusive bounds.
 * @param {string|null} value Text to parse.
 * @param {string} name Name shown in validation errors.
 * @param {number} minimum Minimum accepted value.
 * @param {number} maximum Maximum accepted value.
 * @returns {number} Validated safe integer.
 * @throws {HttpError} For missing, non-decimal, or out-of-range values.
 */
function parseInteger(value, name, minimum, maximum) {
    if (!/^\d+$/.test(value || "")) {
        throw new HttpError(400, "invalid_parameter", name + " must be an integer.");
    }

    const number = Number(value);

    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
        throw new HttpError(
            400, "invalid_parameter",
            name + " must be between " + minimum + " and " + maximum + "."
        );
    }

    return number;
}

/**
 * Parse a positive database ID from a route segment.
 * @param {string} value URL path segment.
 * @returns {number} Validated ID.
 * @throws {HttpError} For an invalid ID.
 */
function parseId(value) {
    return parseInteger(value, "id", 1, Number.MAX_SAFE_INTEGER);
}

/**
 * Read an optional positive ID query parameter.
 * @param {URLSearchParams} searchParams Request query parameters.
 * @param {string} name Parameter name.
 * @returns {number|null} Validated ID or null when absent.
 * @throws {HttpError} For an invalid supplied ID.
 */
function optionalId(searchParams, name) {
    return searchParams.has(name)
        ? parseInteger(searchParams.get(name), name, 1, Number.MAX_SAFE_INTEGER)
        : null;
}

/**
 * Read limit and offset, defaulting to 30 and 0.
 * @param {URLSearchParams} searchParams Request query parameters.
 * @returns {{limit: number, offset: number}} Validated page bounds.
 * @throws {HttpError} For invalid limit or offset values.
 */
function pagination(searchParams) {
    return {
        limit: searchParams.has("limit")
            ? parseInteger(searchParams.get("limit"), "limit", 1, 100)
            : 30,
        offset: searchParams.has("offset")
            ? parseInteger(searchParams.get("offset"), "offset", 0, Number.MAX_SAFE_INTEGER)
            : 0,
    };
}

/**
 * Trim an optional text filter and enforce a 200-character limit.
 * @param {URLSearchParams} searchParams Request query parameters.
 * @param {string} name Parameter name.
 * @returns {string|null} Nonempty filter or null.
 * @throws {HttpError} When the trimmed value exceeds 200 characters.
 */
function textFilter(searchParams, name) {
    const value = searchParams.get(name)?.trim() || "";

    if (value.length > 200) {
        throw new HttpError(400, "invalid_parameter", name + " must be 200 characters or less.");
    }

    return value || null;
}

/**
 * Send a paged API result with the total before pagination.
 * @param {import('node:http').IncomingMessage} req Request.
 * @param {import('node:http').ServerResponse} res Response to finish.
 * @param {{items: object[], total: number}} result Query result.
 * @param {{limit: number, offset: number}} page Applied page bounds.
 * @returns {void}
 */
function sendList(req, res, result, page) {
    sendJson(req, res, 200, {
        data: result.items,
        pagination: {
            limit: page.limit,
            offset: page.offset,
            total: result.total,
        },
    });
}

module.exports = {
    HttpError,
    sendJson,
    sendError,
    sendList,
    parseId,
    optionalId,
    parseInteger,
    pagination,
    textFilter,
};
