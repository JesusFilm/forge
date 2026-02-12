import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(baseDir, "..");
const files = [
  resolve(contractsDir, "graphql/schema.graphql"),
  resolve(contractsDir, "openapi/forge.yaml"),
];

for (const file of files) {
  if (!existsSync(file)) {
    throw new Error(`Missing contract file: ${file}`);
  }
  const content = readFileSync(file, "utf8").trim();
  if (!content) {
    throw new Error(`Empty contract file: ${file}`);
  }
}

console.log("Contracts present and non-empty.");
