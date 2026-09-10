import doctor from "@nwutils/doctor";

await doctor({
  version: "latest",
  manifestUrl: "https://nwjs.io/versions.json",
  cacheDir: "cache",
  srcDir: "./",
});
