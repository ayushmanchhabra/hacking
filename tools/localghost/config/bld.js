import nwbuild from "nw-builder";

import options from "./opt.js";

await nwbuild({ ...options, mode: "build" });
