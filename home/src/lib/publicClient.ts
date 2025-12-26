import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

export const SEPOLIA_RPC_URL = 'https://ethereum-sepolia.publicnode.com';

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC_URL),
});

