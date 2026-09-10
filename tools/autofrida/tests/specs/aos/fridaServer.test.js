import server from "../../../src/aos/fridaServer.js";

await server(
    undefined,
    'com.package.name',
    './tests/specs/aos/burp.crt',
    './tests/specs/aos/frida.script.js'
);
