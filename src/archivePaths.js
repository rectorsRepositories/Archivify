const path = require("node:path");

const archiveRoot = path.resolve(process.env.ARCHIVE_ROOT || (process.platform === "win32"
    ? path.join(__dirname, "../archive")
    : "/Archive"));

const categoryFolders = {
    music: "Music",
    games: "Games",
    pictures: "Pictures",
    videos: "Videos",
};

function resolveArchiveFile(file) {
    const folder = categoryFolders[file.category];
    const parts = file.relative_path?.split(/[\\/]+/);

    if (!folder || !parts?.length || parts.some((part) =>
        !part || part === "." || part === "..")) {
        return null;
    }

    // Indexed absolute paths may come from another machine. The category and
    // relative path identify the file within the archive used by this server.
    const categoryRoot = path.join(archiveRoot, folder);
    // Preserve exact paths for current indexes. Older indexes can fall back to
    // the same relative location in this checkout without serving other roots.
    if (file.path) {
        const indexedPath = path.resolve(file.path);
        const indexedRelative = path.relative(categoryRoot, indexedPath);
        if (indexedRelative && !indexedRelative.startsWith(".." + path.sep)
            && indexedRelative !== ".." && !path.isAbsolute(indexedRelative)) {
            return indexedPath;
        }
    }
    if (parts.some((part) => part.includes(":"))) return null;
    const filePath = path.resolve(categoryRoot, ...parts);
    const relative = path.relative(categoryRoot, filePath);
    if (!relative || relative.startsWith(".." + path.sep) || relative === ".."
        || path.isAbsolute(relative)) {
        return null;
    }
    return filePath;
}

module.exports = { archiveRoot, resolveArchiveFile };
