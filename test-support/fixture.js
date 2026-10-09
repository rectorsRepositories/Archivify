const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const projectRoot = path.resolve(__dirname, "..");

function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "home-archive-test-"));
    const archiveRoot = path.join(root, "archive");
    const dbPath = path.join(root, "archive.db");
    for (const category of ["Music", "Games", "Books", "Pictures", "Videos"]) {
        fs.mkdirSync(path.join(archiveRoot, category), { recursive: true });
    }
    // Schema initialization must receive the temporary path before database.js
    // is imported, because that module opens its connection at import time.
    const result = spawnSync(process.execPath, ["-e", "require('./src/db/schema')"], {
        cwd: projectRoot,
        env: { ...process.env, ARCHIVE_DB: dbPath },
        encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return { root, archiveRoot, dbPath, db: new Database(dbPath) };
}

function closeFixture(fixture) {
    fixture.db.close();
    assert.equal(path.dirname(fixture.root), os.tmpdir());
    fs.rmSync(fixture.root, { recursive: true, force: true });
}

function writeMedia(fixture, category, relativePath, bytes) {
    const folder = {
        music: "Music", games: "Games", books: "Books", pictures: "Pictures", videos: "Videos",
    }[category];
    const fullPath = path.join(fixture.archiveRoot, folder, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, bytes);
    return fullPath;
}

function addFile(fixture, category, relativePath, bytes, options = {}) {
    const folder = {
        music: "Music", games: "Games", books: "Books", pictures: "Pictures", videos: "Videos",
    }[category];
    const fullPath = path.join(fixture.archiveRoot, folder, ...relativePath.split("/"));
    if (!options.missing) writeMedia(fixture, category, relativePath, bytes);
    const filename = path.basename(fullPath);
    const row = fixture.db.prepare(
        "INSERT INTO files (path, relative_path, filename, category, extension, size, modified_at, indexed_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(fullPath, relativePath, filename, category,
        path.extname(filename).toLowerCase() || null, Buffer.byteLength(bytes), 1000, 2000);
    return Number(row.lastInsertRowid);
}

function runIndexer(fixture, script, args = [], extraEnv = {}) {
    const result = spawnSync(process.execPath, [path.join(projectRoot, script), ...args], {
        cwd: projectRoot,
        env: {
            ...process.env,
            ARCHIVE_ROOT: fixture.archiveRoot,
            ARCHIVE_DB: fixture.dbPath,
            IGDB_CLIENT_ID: "",
            IGDB_CLIENT_SECRET: "",
            GAME_EXTRA_EXTENSIONS: "",
            ...extraEnv,
        },
        encoding: "utf8",
    });
    return result;
}

const serverProgram = `
    const { createServer } = require("./src/server");
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
        process.stdout.write("READY:" + server.address().port + "\\n");
    });
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;

function startApi(dbPath) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["-e", serverProgram], {
            cwd: projectRoot,
            env: { ...process.env, ARCHIVE_DB: dbPath,
                ARCHIVE_ROOT: path.join(path.dirname(dbPath), "archive") },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const timer = setTimeout(() => fail(new Error("API startup timed out: " + stderr)), 5000);
        function fail(error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.kill();
            reject(error);
        }
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
            const match = /READY:(\d+)\r?\n/.exec(stdout);
            if (!match || settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ child, baseUrl: "http://127.0.0.1:" + match[1] });
        });
        child.once("error", fail);
        child.once("exit", (code) => fail(new Error("API exited (" + code + "): " + stderr)));
    });
}

function stopApi(child) {
    return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("exit", resolve);
        child.kill();
    });
}

async function getJson(baseUrl, endpoint, options) {
    const response = await fetch(baseUrl + endpoint, options);
    return { response, body: await response.json() };
}

module.exports = {
    projectRoot, createFixture, closeFixture, writeMedia, addFile,
    runIndexer, startApi, stopApi, getJson,
};
