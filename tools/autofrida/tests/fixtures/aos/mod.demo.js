import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import url from "node:url";

import mod from "../../../src/aos/mod.js";
import { cleanManifest } from "../../../src/aos/util.js";

mod(undefined, 'com.android.chrome', {
    dname: {
        CN: 'Developer',
        OU: 'IIT',
        O: 'ABC',
        L: 'SFO',
        ST: 'California',
        C: 'USA'
    }
}, function (packageDirPath) {
    // const dir = path.resolve(packageDirPath, "decoded", "base", "res", "drawable");
    // for (const file of fs.readdirSync(dir)) {
    //     const absFile = path.join(dir, file);
    //     const outFile = path.resolve(absFile.replace(/\$/g, ''));
    //     if (file.includes('$')) {
    //         console.log('[ INFO ] Replacing', absFile, 'with', outFile);
    //         fs.renameSync(absFile, outFile);
    //     }
    // }
});
