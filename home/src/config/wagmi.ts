import { createConfig, createStorage, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { sepolia } from 'wagmi/chains';

const memory = new Map<string, string>();

const storage = createStorage({
  storage: {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
    removeItem: (key) => {
      memory.delete(key);
    },
  },
});

const SEPOLIA_RPC_URL = 'https://ethereum-sepolia.publicnode.com';

export const config = createConfig({
  chains: [sepolia],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [sepolia.id]: http(SEPOLIA_RPC_URL),
  },
  ssr: false,
  storage,
});
