import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import type { HardhatUserConfig } from "hardhat/config";
import "solidity-coverage";

import * as dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import "./tasks/accounts";
import "./tasks/SilentLedger";
import "./tasks/syncFrontend";

dotenv.config();

function readDotEnvFallback(key: string): string | undefined {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#")) continue;

      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      if (match[1] !== key) continue;

      const value = match[2].trim();
      if (value) return value;

      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (!next || next.startsWith("#")) continue;
        if (next.includes("=")) break;
        return next;
      }
    }
  } catch {
    // ignored
  }

  return undefined;
}

function getOptionalEnv(name: string): string | undefined {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const fallback = readDotEnvFallback(name)?.trim();
  if (fallback) return fallback;
  return undefined;
}

const INFURA_API_KEY = getOptionalEnv("INFURA_API_KEY");
const PRIVATE_KEY_RAW = getOptionalEnv("PRIVATE_KEY");
const PRIVATE_KEY = PRIVATE_KEY_RAW ? (PRIVATE_KEY_RAW.startsWith("0x") ? PRIVATE_KEY_RAW : `0x${PRIVATE_KEY_RAW}`) : undefined;
const SEPOLIA_RPC_URL = INFURA_API_KEY ? `https://sepolia.infura.io/v3/${INFURA_API_KEY}` : "https://ethereum-sepolia.publicnode.com";

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: 0,
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || "",
    },
  },
  gasReporter: {
    currency: "USD",
    enabled: process.env.REPORT_GAS ? true : false,
    excludeContracts: [],
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
      url: SEPOLIA_RPC_URL,
    },
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
  solidity: {
    version: "0.8.27",
    settings: {
      metadata: {
        // Not including the metadata hash
        // https://github.com/paulrberg/hardhat-template/issues/31
        bytecodeHash: "none",
      },
      // Disable the optimizer when debugging
      // https://hardhat.org/hardhat-network/#solidity-optimizer-support
      optimizer: {
        enabled: true,
        runs: 800,
      },
      evmVersion: "cancun",
    },
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
};

export default config;
