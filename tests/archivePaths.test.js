const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { archiveRoot, resolveArchiveFile } = require("../src/archivePaths");

test("serves copied index paths from the configured archive root", () => {
    const localCover = path.join(archiveRoot, "Music", "Artist", "Album", "cover.jpg");
    const stale = { category: "music", relative_path: "Artist/Album/cover.jpg",
        path: "/Archive/Music/Artist/Album/cover.jpg" };
    const outside = { ...stale, path: path.join(path.dirname(archiveRoot), "outside.jpg") };
    assert.equal(resolveArchiveFile(outside), localCover);
    if (process.platform === "win32") assert.equal(resolveArchiveFile(stale), localCover);

    // An exact indexed path is useful for legacy rows whose relative display
    // name differs from the actual filename, but must stay under this root.
    const localAlias = path.join(archiveRoot, "Music", "Artist", "Album", "safe-name.jpg");
    assert.equal(resolveArchiveFile({ ...stale, path: localAlias }), localAlias);
});

test("rejects invalid categories and relative paths", () => {
    for (const file of [
        { category: "unknown", relative_path: "cover.jpg" },
        { category: "music", relative_path: "../cover.jpg" },
        { category: "music", relative_path: "/cover.jpg" },
        { category: "music", relative_path: "" },
    ]) {
        assert.equal(resolveArchiveFile(file), null);
    }
});
