import Nmap from "../../../src/net/nmap.js";

const nmap = new Nmap("nmap");

const scan = await nmap.ping("ARP", "18.164.246.37/24");

console.log(scan);
