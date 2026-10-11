/* eslint-disable @typescript-eslint/no-var-requires */
// graph-cli does not validate declared eth_calls (`calls:` on event handlers),
// and a wrong one only shows up as "Declared calls failed" in graph-node logs.
// Check each against the ABIs: the function exists with that many arguments,
// arguments are parameters of the handled event, and the address is
// event.address, an event parameter or a literal address.
export {};

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const manifestPath = path.join(__dirname, "..", process.argv[2] || "subgraph.yaml");
const root = path.dirname(manifestPath);
const manifest = yaml.load(fs.readFileSync(manifestPath, "utf-8"));

const loadAbi = (file: string) => {
  const json = JSON.parse(fs.readFileSync(path.join(root, file), "utf-8"));
  return Array.isArray(json) ? json : json.abi;
};

const errors: string[] = [];
let checked = 0;

for (const ds of [...manifest.dataSources, ...(manifest.templates || [])]) {
  const abis = {};
  for (const abi of ds.mapping.abis) abis[abi.name] = loadAbi(abi.file);
  const sourceAbi = abis[ds.source.abi];

  for (const handler of ds.mapping.eventHandlers || []) {
    const where = `${ds.name}.${handler.handler}`;
    const eventName = handler.event.split("(")[0];
    const params = new Set(
      sourceAbi
        .filter((e) => e.type === "event" && e.name === eventName)
        .flatMap((e) => e.inputs.map((i) => i.name))
    );
    const isParam = (expr: string) =>
      expr.startsWith("event.params.") && params.has(expr.slice(13));

    for (const [label, expr] of Object.entries(handler.calls || {})) {
      checked++;
      const match = /^(\w+)\[(.+)\]\.(\w+)\((.*)\)$/.exec(expr as string);
      if (!match) {
        errors.push(`${where} ${label}: cannot parse ${expr}`);
        continue;
      }
      const [, contract, address, fn, rawArgs] = match;
      const args = rawArgs.split(",").map((a) => a.trim()).filter(Boolean);
      if (!abis[contract]) {
        errors.push(`${where} ${label}: ABI ${contract} is not listed for ${ds.name}`);
        continue;
      }
      if (
        address !== "event.address" &&
        !/^0x[0-9a-fA-F]{40}$/.test(address) &&
        !isParam(address)
      ) {
        errors.push(`${where} ${label}: invalid address ${address}`);
      }
      const fns = abis[contract].filter((f) => f.type === "function" && f.name === fn);
      if (!fns.some((f) => f.inputs.length === args.length)) {
        errors.push(`${where} ${label}: ${contract} has no ${fn} taking ${args.length} argument(s)`);
      }
      for (const arg of args) {
        if (!isParam(arg)) errors.push(`${where} ${label}: ${arg} is not a ${eventName} parameter`);
      }
    }
  }
}

console.log(`${checked} declared calls checked`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
