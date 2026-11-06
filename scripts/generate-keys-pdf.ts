import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTestnetKeysPdf, type TestnetPdfDeployment } from "../src/lib/testnet-keys-pdf.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

async function main() {
  const depRaw = await fs.readFile(
    path.join(rootDir, "src/data/deployments/elysium-testnet.json"),
    "utf8",
  );
  const dep = JSON.parse(depRaw) as TestnetPdfDeployment;
  const pdf = buildTestnetKeysPdf(dep);
  const outPath = path.join(rootDir, "public/canon-testnet-keys.pdf");
  await fs.writeFile(outPath, pdf);
  console.log(`Generated ${outPath} (${pdf.byteLength} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
