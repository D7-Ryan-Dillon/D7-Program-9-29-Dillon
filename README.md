# Tile Analysis + Arrangement Workspace

A Next.js app for the Design 7 studio project. It reads tiles exported from
the erosion Grasshopper tool chain (each tile's `<name>_analysis` folder),
shows them in a 3D viewer, scores them against the studio's 12 descriptors,
and — in the **Arrange** tab — auto-generates a connected, printable
composition out of a bank of uploaded tiles, with tools to review and
selectively regenerate the joints between pieces.

Nothing here touches a server or database — everything runs entirely in
your browser. Uploading a tile never leaves your machine.

## Requirements

- **[Node.js](https://nodejs.org/)** 18.18 or newer (20 LTS recommended).
  Check with `node -v` in a terminal. If that fails or shows an older
  version, install the LTS version from nodejs.org (just run the
  installer, defaults are fine).
- **[Git](https://git-scm.com/downloads)** — needed once, to download
  (clone) this repo. Check with `git --version`. If that fails, install it
  (defaults are fine there too).

## Getting it running (first time)

Open a terminal (PowerShell on Windows, Terminal on Mac) and run:

```bash
git clone https://github.com/D7-Ryan-Dillon/D7-Program-9-29-Dillon.git
cd D7-Program-9-29-Dillon
npm install
npm run dev
```

`npm install` downloads all the packages the app depends on — it can take
a minute or two the first time, and only needs to be re-run later if
`package.json` changes. `npm run dev` starts the app.

Once you see something like `- Local: http://localhost:3000` in the
terminal, open **http://localhost:3000** in your browser (Chrome or Edge
work best — folder drag-and-drop relies on an API those support best).

To stop the server, click into that terminal and press `Ctrl+C`.

### Getting updates later

Once you've cloned it once, you don't need to clone again — just pull the
latest changes from inside the project folder:

```bash
git pull
npm install
npm run dev
```

(`npm install` only actually does anything if the dependencies changed —
safe to run every time.)

## The three tabs

### 01 Viewer

Drag a tile's `<name>_analysis` folder (unzipped) straight onto the drop
zone, or click **Choose folder** / **Choose .zip**. Only the `_analysis`
folder is needed, not `_reference`. You can load more than one tile — a
switcher bar across the top lets you flip between them and close ones you
don't need.

Once a tile is loaded: switch **display mode** (Rendered / Ghosted), jump
to a named view (Top, Front, Right, etc. — same naming as Rhino, plus
Perspective), and toggle/recolor the foam and void pieces independently.
Drag to orbit, right-drag (or two-finger drag) to pan, scroll to zoom. The
right panel is the metrics legend — volumes, per-face openings, void
components, surface areas, the erosion settings that produced the tile.

### 02 Analysis

Reads the currently-active tile and scores it against the studio's 12
descriptors (Carved, Stepped, Porous, Continuous, Resistant, Threaded,
Graduated, Non-hierarchical Circulation, Force-driven, Light-filled,
Monumental, Spatial Density) — both a qualitative and quantitative score
per descriptor, each with the criteria it was judged against.

### 03 Arrange

Takes every tile you've loaded (check the ones you want in the **Bank**
panel) and grows them into one connected composition.

- **Auto-generate settings**: how many pieces (**Amount**), how many
  copies of any one tile are allowed (**Max copies of one piece**), a
  **Scale range** pieces can be resized within, a **Seed** for
  reproducible randomness, and **Spine-first growth** — grows one
  dominant chain through the biggest opening first, then branches, rather
  than branching immediately.
- Click **Auto-generate**. It grows the composition by matching real
  opening shapes between pieces — not just at the surface, but checking
  that the void space stays open a bit behind the joining face too —
  refusing weak matches rather than forcing them.
- **Joints**: after generating, every joint (connection between two
  pieces) is listed with its match score. Mark any joint **Good** or
  **Bad**, then **Regenerate marked** to regrow only the bad ones with a
  fresh random attempt — everything else in the composition is left
  completely untouched.
- **Solid export → Smooth & seal into 1 solid**: fuses every piece into
  one real, watertight-as-possible solid (a true boolean union) and
  softens the seams — this is what you want before 3D printing or
  bringing the result into Rhino as one clean mesh. Click again
  (**Unsmooth**) to go back to the separate pieces.
- **Add manually** / the piece editor / **Placed pieces** list let you add
  a tile by hand, and reposition, rotate, mirror, rescale, snap, or remove
  any individual piece.
- **Reading space through: Voids / Foams** — the arrangement itself is
  always driven by the void geometry (that's what defines usable space);
  this just picks which mesh (the carved-out void, or the solid foam
  around it) is actually shown/exported.
- **Export OBJ** downloads the current composition (the smoothed solid if
  you've built one, otherwise the separate pieces) as a `.obj` file.

## Deploying / sharing

This is a static, backend-free app. `npm run build` produces a static
build that can be deployed anywhere that serves static files — for
example [Vercel](https://vercel.com) (`npx vercel` from this folder, or
connect this GitHub repo on vercel.com). Anyone with the resulting URL
could then use it with no install and no account.

## Project layout

```
app/                    Next.js App Router pages (app/page.tsx is the whole app shell)
components/
  shared/                Header, tab navigation, logo
  viewer/                 3D viewport, upload zone, display-mode/view/visibility controls, metrics legend
  analysis/               Descriptor matrix data + Analysis tab
  arrange/                Bank, settings, joints panel, viewport, and per-piece editing for the Arrange tab
lib/
  types.ts               Typed shapes for the exported bundle (manifest, tile.json, faces.json, sections.json)
  ingest.ts               Turns a dropped folder or .zip into a typed ParsedTile
  faceViews.ts            Camera math for the 6 named orthographic views
  scoring/                The 12-descriptor scoring engine used by the Analysis tab
  arrange/                Auto-generate, real-shape + real-depth matching, the connection graph and
                           resumable regrowth, CSG smoothing/sealing — the Arrange tab's engine
```

## Known limitations

- No backend, on purpose — nothing is saved between browser sessions.
  Closing the tab loses whatever's loaded; re-upload to pick up where you
  left off.
- The ambient-occlusion pass in Rendered mode is skipped (falls back to
  plain shaded rendering) if your browser/GPU can't run it — the rest of
  the viewer still works normally either way.
- Category/typology labels (e.g. "Office · Folded / undulating work
  surface") are guessed from the tile's file name, since the export
  itself doesn't carry that information — the tile's real name and ID are
  always shown too, so nothing is hidden if the guess is wrong.
- Auto-generate and smoothing are real geometry computations running in
  your browser — a large **Amount** or a big composition can take a
  noticeable number of seconds, especially for smoothing.
