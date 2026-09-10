import Subfinder from "../../../src/web/subfinder.js";

const subfinder = new Subfinder("subfinder");

const subdomains = subfinder.find(["gemini.com"]);
console.log(subdomains);
