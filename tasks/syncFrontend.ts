import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import fs from "node:fs";
import path from "node:path";

type DeploymentJson = {
  address: string;
  abi: unknown;
};

function toTsLiteral(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

task("task:sync-frontend", "Syncs frontend ABI + default address from hardhat-deploy deployments")
  .addOptionalParam("outDir", "Frontend config output dir", "home/src/config")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const deploymentPath = path.resolve(process.cwd(), "deployments", hre.network.name, "SilentLedger.json");
    if (!fs.existsSync(deploymentPath)) {
      throw new Error(`Missing deployment file: ${deploymentPath}. Deploy first: npx hardhat deploy --network ${hre.network.name}`);
    }

    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as DeploymentJson;
    if (!deployment.address || typeof deployment.address !== "string") {
      throw new Error(`Invalid deployment JSON: missing address`);
    }

    const outDir = path.resolve(process.cwd(), String(taskArgs.outDir));
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outPath = path.join(outDir, "silentLedger.ts");
    const abiLiteral = toTsLiteral(deployment.abi);

    const content =
      `export const DEFAULT_SILENT_LEDGER_ADDRESS = ${JSON.stringify(deployment.address)};\n\n` +
      `export const SILENT_LEDGER_ABI = ${abiLiteral} as const;\n`;

    fs.writeFileSync(outPath, content, "utf8");
    console.log(`Wrote ${path.relative(process.cwd(), outPath)} from ${path.relative(process.cwd(), deploymentPath)}`);
  });

