import { readFile, rename, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { catalogDocumentSchema, collectionDocumentSchema } from "../src/content.ts";
import { listJsonFiles, validateContent } from "./validate-content.mjs";

const projectDirectory = resolve(import.meta.dirname, "..");
const contentDirectory = resolve(projectDirectory, "content");
const collectionsDirectory = resolve(contentDirectory, "collections");

await validateContent({ validateCatalog: false });

const collections = await Promise.all(
  (await listJsonFiles(collectionsDirectory)).map(async (path) => ({
    relativePath: relative(collectionsDirectory, path).split(sep).join("/"),
    document: collectionDocumentSchema.parse(JSON.parse(await readFile(path, "utf8")))
  }))
);

const catalog = catalogDocumentSchema.parse({
  schemaVersion: 1,
  collections: collections.map(({ relativePath, document }) => ({
    id: document.id,
    kind: document.kind,
    title: document.title,
    ...(document.subtitle ? { subtitle: document.subtitle } : {}),
    lessonCount: document.lessons.length,
    documentKey: `collections/${relativePath}`
  }))
});

const target = resolve(contentDirectory, "catalog.json");
const temporary = `${target}.tmp`;
await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
await rename(temporary, target);
console.log(JSON.stringify({ collections: catalog.collections.length }));
