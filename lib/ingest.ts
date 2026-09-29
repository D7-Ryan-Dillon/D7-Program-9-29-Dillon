// Turns a dropped `_analysis` folder (or a zip of one) into a typed
// ParsedTile. Manifest-first, per the HANDOFF: manifest.json lists every
// file in the bundle with a machine-readable role, so everything else is
// looked up by role rather than by guessing a fixed path.

import JSZip from "jszip";
import type {
  FacesJson,
  Manifest,
  ManifestFileEntry,
  ParsedTile,
  ParsedTileName,
  SectionsJson,
  TileJson,
} from "./types";

export class IngestError extends Error {}

// A Blob covers both File (from drag-drop / <input>) and the blobs JSZip
// hands back, so the rest of this module doesn't care which source it came
// from.
type FileMap = Map<string, Blob>;

// The File and Directory Entries API (webkitGetAsEntry / readEntries) is
// non-standard and how fully it's typed varies across TypeScript's bundled
// lib.dom.d.ts versions. These local shapes cover only what's used below,
// so this file compiles the same regardless of the installed TS version.
interface FSEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}
interface FSFileEntry extends FSEntry {
  file(success: (file: File) => void, error?: (err: unknown) => void): void;
}
interface FSDirectoryReader {
  readEntries(
    success: (entries: FSEntry[]) => void,
    error?: (err: unknown) => void,
  ): void;
}
interface FSDirectoryEntry extends FSEntry {
  createReader(): FSDirectoryReader;
}
interface EntryCapableItem {
  webkitGetAsEntry?: () => FSEntry | null;
}

// --------------------------------------------------------- reading a drop

/** Recursively read a directory reader (it can return entries in batches
 * and you must keep calling readEntries() until it returns empty). */
function readAllEntries(reader: FSDirectoryReader): Promise<FSEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FSEntry[] = [];
    const readBatch = () => {
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(all);
        } else {
          all.push(...entries);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

function readFileEntry(entry: FSFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(entry: FSEntry, path: string, out: FileMap): Promise<void> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FSFileEntry);
    out.set(path, file);
  } else if (entry.isDirectory) {
    const reader = (entry as FSDirectoryEntry).createReader();
    const children = await readAllEntries(reader);
    for (const child of children) {
      await walkEntry(child, path ? `${path}/${child.name}` : child.name, out);
    }
  }
}

/** Build a flat relative-path -> Blob map from a drop event's DataTransfer. */
export async function buildFileMapFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<FileMap> {
  const out: FileMap = new Map();
  const items = dataTransfer.items;

  if (items && items.length > 0) {
    const entries: FSEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = (items[i] as unknown as EntryCapableItem).webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      await Promise.all(entries.map((e) => walkEntry(e, e.name, out)));
      return out;
    }
  }

  // Fallback: plain file list (no folder structure API available). Chrome
  // still sets webkitRelativePath on files picked via a folder <input>.
  const files = dataTransfer.files;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const anyF = f as File & { webkitRelativePath?: string };
    out.set(anyF.webkitRelativePath || f.name, f);
  }
  return out;
}

/** Same, for a plain <input type="file" webkitdirectory> change event. */
export function buildFileMapFromFileList(fileList: FileList): FileMap {
  const out: FileMap = new Map();
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    const anyF = f as File & { webkitRelativePath?: string };
    out.set(anyF.webkitRelativePath || f.name, f);
  }
  return out;
}

/** Unpack a .zip of an `_analysis` folder into the same flat map shape. */
export async function buildFileMapFromZip(file: File | Blob): Promise<FileMap> {
  const zip = await JSZip.loadAsync(file);
  const out: FileMap = new Map();
  const entries = Object.values(zip.files);
  await Promise.all(
    entries
      .filter((e) => !e.dir)
      .map(async (e) => {
        const blob = await e.async("blob");
        out.set(e.name, blob);
      }),
  );
  return out;
}

// ------------------------------------------------------------ resolution

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function findManifest(fileMap: FileMap): { path: string; rootPrefix: string } {
  const candidates: string[] = [];
  for (const key of fileMap.keys()) {
    const norm = normalizePath(key);
    if (norm === "manifest.json" || norm.endsWith("/manifest.json")) {
      candidates.push(key);
    }
  }
  if (candidates.length === 0) {
    throw new IngestError(
      "No manifest.json found. Drop the whole *_analysis folder (or a zip of it) — the app reads manifest.json first to find everything else.",
    );
  }
  // Prefer the shallowest match, in case a wrapping folder or multiple
  // tiles ended up in the same drop.
  candidates.sort(
    (a, b) => normalizePath(a).split("/").length - normalizePath(b).split("/").length,
  );
  const path = candidates[0];
  const norm = normalizePath(path);
  const rootPrefix = norm === "manifest.json" ? "" : norm.slice(0, -"manifest.json".length);
  return { path, rootPrefix };
}

function resolveBlob(fileMap: FileMap, rootPrefix: string, relPath: string): Blob {
  const rel = normalizePath(relPath);
  const direct = fileMap.get(rootPrefix + rel) ?? fileMap.get(rel);
  if (direct) return direct;

  // Fallback: some zip tools add an extra wrapping folder, or a browser's
  // drop path separators disagree with the manifest's. Match by suffix.
  const suffix = `/${rel}`;
  for (const [key, blob] of fileMap.entries()) {
    const norm = normalizePath(key);
    if (norm === rel || norm.endsWith(suffix)) return blob;
  }
  throw new IngestError(
    `Expected file "${relPath}" (from manifest.json) was not found in the dropped folder.`,
  );
}

async function readJson<T>(blob: Blob): Promise<T> {
  const text = await blob.text();
  return JSON.parse(text) as T;
}

function findByRole(manifest: Manifest, role: string): ManifestFileEntry | undefined {
  return manifest.files.find((f) => f.role === role);
}

// --------------------------------------------------------------- naming

function parseTileName(name: string): ParsedTileName {
  // The exporter's own re-export counter is always a lowercase "_vN"
  // suffix (erosion_engine_5f._unique_pair). The V2 natural-erosion set's
  // own chosen names end in an uppercase "_V2" that is part of the name
  // itself, not a version counter — JS's default case-sensitive regex
  // keeps these apart.
  let working = name.replace(/_v\d+$/, "");
  const isNaturalSetV2 = /_V2$/.test(working);
  working = working.replace(/_V2$/, "");

  const match = working.match(/^(gathering|office|lobby)_(\d+)_(.+)$/i);
  if (!match) {
    return { category: null, slotNumber: null, typology: null, isNaturalSetV2 };
  }
  const [, categoryRaw, slotRaw, typologyRaw] = match;
  return {
    category: categoryRaw.charAt(0).toUpperCase() + categoryRaw.slice(1).toLowerCase(),
    slotNumber: parseInt(slotRaw, 10),
    typology: typologyRaw.replace(/_/g, " ").trim(),
    isNaturalSetV2,
  };
}

// ------------------------------------------------------------- main entry

export async function parseTileBundle(
  fileMap: FileMap,
  sourceKind: "folder" | "zip",
): Promise<ParsedTile> {
  const { path: manifestPath, rootPrefix } = findManifest(fileMap);
  const manifestBlob = fileMap.get(manifestPath);
  if (!manifestBlob) throw new IngestError("Could not read manifest.json.");
  const manifest = await readJson<Manifest>(manifestBlob);

  if (!manifest.schema?.startsWith("erosion-tile/")) {
    throw new IngestError(
      `manifest.json has an unrecognized schema ("${manifest.schema}"). Expected an erosion-tile export.`,
    );
  }

  const tileEntry = findByRole(manifest, "tile.json");
  if (!tileEntry) {
    throw new IngestError("manifest.json has no tile.json entry — is this a complete _analysis folder?");
  }
  const tile = await readJson<TileJson>(resolveBlob(fileMap, rootPrefix, tileEntry.file));

  const facesEntry = findByRole(manifest, "data.faces");
  if (!facesEntry) throw new IngestError("manifest.json has no data.faces entry (faces.json missing).");
  const faces = await readJson<FacesJson>(resolveBlob(fileMap, rootPrefix, facesEntry.file));

  const sectionsEntry = findByRole(manifest, "data.sections");
  if (!sectionsEntry) throw new IngestError("manifest.json has no data.sections entry (sections.json missing).");
  const sections = await readJson<SectionsJson>(resolveBlob(fileMap, rootPrefix, sectionsEntry.file));

  const modelEntry = findByRole(manifest, "model.glb");
  if (!modelEntry) throw new IngestError("manifest.json has no model.glb entry — no 3D model to show.");
  const modelBlob = resolveBlob(fileMap, rootPrefix, modelEntry.file);
  const glbUrl = URL.createObjectURL(modelBlob);
  const glbNodeNames = Array.isArray(modelEntry.nodes)
    ? (modelEntry.nodes as string[])
    : ["foam", "void"];

  let thumbnailUrl: string | null = null;
  const thumbEntry = findByRole(manifest, "image.thumbnail");
  if (thumbEntry) {
    try {
      thumbnailUrl = URL.createObjectURL(resolveBlob(fileMap, rootPrefix, thumbEntry.file));
    } catch {
      thumbnailUrl = null; // non-fatal — the legend just won't have a thumbnail
    }
  }

  return {
    manifest,
    tile,
    faces,
    sections,
    glbUrl,
    glbNodeNames,
    thumbnailUrl,
    rootPrefix,
    sourceKind,
    parsedName: parseTileName(tile.name),
  };
}

/** Revoke the object URLs a ParsedTile created, before loading another tile. */
export function releaseParsedTile(tile: ParsedTile | null): void {
  if (!tile) return;
  URL.revokeObjectURL(tile.glbUrl);
  if (tile.thumbnailUrl) URL.revokeObjectURL(tile.thumbnailUrl);
}
