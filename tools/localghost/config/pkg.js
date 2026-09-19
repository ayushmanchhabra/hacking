import fs from "node:fs/promises";
import path from "node:path";

import nwbuild from "nw-builder";

import options from "./opt.js";

const packagePath = await nwbuild({
  ...options,
  mode: "package",
  format: "AppImage",
});

// Move the package to the output directory
// TODO: fix in nw-builder
const destination = path.join(options.outDir, path.basename(packagePath));
await fs.rename(packagePath, destination);
