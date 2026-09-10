import Frida from "../../../src/aos/frida.js";

const frida = new Frida("frida");

console.log(frida.version());
