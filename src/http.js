class HttpError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

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

function parseId(value) {
    return parseInteger(value, "id", 1, Number.MAX_SAFE_INTEGER);
}

function optionalId(searchParams, name) {
    return searchParams.has(name)
        ? parseInteger(searchParams.get(name), name, 1, Number.MAX_SAFE_INTEGER)
        : null;
}

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

function textFilter(searchParams, name) {
    const value = searchParams.get(name)?.trim() || "";

    if (value.length > 200) {
        throw new HttpError(400, "invalid_parameter", name + " must be 200 characters or less.");
    }

    return value || null;
}

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
