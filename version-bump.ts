import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version ?? "0.0.0";

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// update versions.json with target version and minAppVersion from manifest.json
let versions: Record<string, string> = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
