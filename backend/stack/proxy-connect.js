// Minimal HTTP CONNECT proxy client for ssh ProxyCommand.
// Reads the proxy address from the standard *_PROXY environment variables at
// runtime (no credentials are stored in this file) and pipes the SSH session
// through a CONNECT tunnel to the target host:port given as argv[2], argv[3].
const net = require("net");
const { URL } = require("url");

const proxyEnv = process.env.HTTPS_PROXY || process.env.https_proxy ||
                 process.env.ALL_PROXY || process.env.all_proxy || "";
if (!proxyEnv) {
    console.error("no proxy configured in environment");
    process.exit(1);
}
const proxy = new URL(proxyEnv);
const targetHost = process.argv[2];
const targetPort = process.argv[3];

const socket = net.connect(Number(proxy.port), proxy.hostname, () => {
    let auth = "";
    if (proxy.username) {
        const user = decodeURIComponent(proxy.username);
        const pass = decodeURIComponent(proxy.password || "");
        auth = "Proxy-Authorization: Basic " +
               Buffer.from(`${user}:${pass}`).toString("base64") + "\r\n";
    }
    socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
                 `Host: ${targetHost}:${targetPort}\r\n${auth}\r\n`);
});

let header = Buffer.alloc(0);
let established = false;
socket.on("data", (chunk) => {
    if (established) {
        process.stdout.write(chunk);
        return;
    }
    header = Buffer.concat([header, chunk]);
    const end = header.indexOf("\r\n\r\n");
    if (end === -1) return;
    const statusLine = header.slice(0, header.indexOf("\r\n")).toString();
    if (!/^HTTP\/1\.[01] 2/.test(statusLine)) {
        console.error("proxy CONNECT failed: " + statusLine);
        process.exit(1);
    }
    established = true;
    const rest = header.slice(end + 4);
    if (rest.length) process.stdout.write(rest);
    process.stdin.pipe(socket);
});
socket.on("error", (err) => { console.error("proxy socket error: " + err.message); process.exit(1); });
socket.on("close", () => process.exit(0));
process.stdin.on("error", () => {});
