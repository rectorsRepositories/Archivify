const cover = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0XcAAAAASUVORK5CYII=", "base64");

const metadata = `<d:title id="title">Fixture Book</d:title>
    <meta property="file-as" refines="#title">Book, Fixture</meta>
    <d:title id="subtitle">A Test Edition</d:title><meta property="title-type" refines="#subtitle">subtitle</meta>
    <d:creator id="author">Alice Example</d:creator>
    <meta property="file-as" refines="#author">Example, Alice</meta><meta property="role" refines="#author">aut</meta>
    <d:contributor id="translator">Bob Translator</d:contributor><meta property="role" refines="#translator">trl</meta>
    <d:identifier opf:scheme="ISBN">978-0-306-40615-7</d:identifier>
    <d:identifier>http://www.gutenberg.org/ebooks/123</d:identifier>
    <d:language>en</d:language><d:language>fr</d:language><d:subject>Fiction</d:subject>
    <d:description>A searchable description.</d:description><d:publisher>Fixture Press</d:publisher>
    <d:date>2020-02-03</d:date><d:rights>Fixture rights</d:rights>
    <meta property="belongs-to-collection" id="series">Test Series</meta>
    <meta property="collection-type" refines="#series">series</meta><meta property="group-position" refines="#series">1.5</meta>
    <meta property="rendition:layout">reflowable</meta><meta property="schema:accessibilityFeature">tableOfContents</meta>`;

/**
 * Build a tiny real EPUB ZIP with overridable package metadata and members.
 * The mimetype entry is first and uncompressed, as required by EPUB containers.
 * @param {{version?: string, metadata?: string, cover?: boolean, content?: string, files?: object, container?: string}} [options] Fixture variations.
 * @returns {Promise<Buffer>} Complete EPUB bytes.
 */
async function createEpub(options = {}) {
    const { ZipArchive } = await import("archiver");
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const result = new Promise((resolve, reject) => {
        const chunks = [];
        archive.on("data", (chunk) => chunks.push(chunk));
        archive.on("error", reject);
        archive.on("end", () => resolve(Buffer.concat(chunks)));
    });
    const withCover = options.cover !== false;
    const legacy = options.version === "2.0";
    const entries = {
        "META-INF/container.xml": options.container || `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
        "EPUB/package.opf": `<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" xmlns:d="http://purl.org/dc/elements/1.1/" version="${options.version || "3.0"}" unique-identifier="book-id">
            <metadata>${options.metadata ?? metadata}${withCover && legacy ? '<meta name="cover" content="cover"/>' : ""}</metadata>
            <manifest><item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/>
            <item id="navigation" href="${legacy ? "toc.ncx" : "nav.xhtml"}" media-type="${legacy ? "application/x-dtbncx+xml" : "application/xhtml+xml"}" ${legacy ? "" : 'properties="nav"'}/>
            ${withCover ? `<item id="cover" href="images/cover.png" media-type="image/png" ${legacy ? "" : 'properties="cover-image"'}/>` : ""}</manifest>
            <spine toc="navigation"><itemref idref="chapter"/></spine></package>`,
        "EPUB/text/chapter.xhtml": options.content || '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ignored title</title></head><body><p>One two <em>three</em> four five.</p><script>ignore these words</script></body></html>',
        "EPUB/nav.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="page-list"><ol><li><a href="text/chapter.xhtml#p10">10</a></li><li><a href="text/chapter.xhtml#p11">11</a></li></ol></nav></body></html>',
        "EPUB/toc.ncx": '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><pageList><pageTarget value="10"/><pageTarget value="11"/></pageList></ncx>',
        ...(withCover ? { "EPUB/images/cover.png": cover } : {}),
        ...options.files,
    };
    archive.append("application/epub+zip", { name: "mimetype", store: true });
    for (const [name, value] of Object.entries(entries)) {
        if (value !== null) archive.append(value, { name });
    }
    await archive.finalize();
    return result;
}

module.exports = { createEpub, cover };
