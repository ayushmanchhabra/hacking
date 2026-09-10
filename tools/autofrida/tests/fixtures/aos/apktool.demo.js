import Apktool from "../../../src/aos/apktool.js";

// Memu has its own adb.exe, hence the file path needs to be explicity passed.
const apktool = new Apktool("apktool");

// apktool.decode("../../../../cookierun/base.apk", "../../../../cookierun/base")

// apktool.decode("../../../../cookierun/split_config.arm64_v8a.apk", "../../../../cookierun/split_config.arm64_v8a")

apktool.build("../../../../cookierun/base", "../../../../cookierun/base.apk");
// apktool.build("../../../../cookierun/split_config.arm64_v8a", "../../../../cookierun/split_config.arm64_v8a.apk");
