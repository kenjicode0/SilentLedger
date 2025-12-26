# SilentLedger

SilentLedger is a privacy-first on-chain ledger that lets each user store encrypted messages while keeping the per-user
encryption key itself encrypted with Fully Homomorphic Encryption (FHE) on the blockchain. The result is a public ledger
of ciphertext with user-controlled decryption, no backend, and no plaintext on-chain.

## Project Goals

- Enable per-user private notes on a public chain without a centralized server.
- Keep the ledger key encrypted on-chain using Zama FHEVM primitives.
- Make decryption an explicit, user-authorized action in the client.
- Keep the frontend stateless (no localstorage, no backend, no environment variables).

## Problems This Solves

- **Public chain transparency:** data on-chain is readable by everyone by default.
- **Key exposure risk:** storing symmetric keys off-chain or in a backend creates custody and breach risks.
- **Single-point-of-failure backends:** most encrypted note apps still rely on servers to manage keys or storage.
- **Auditable ownership:** users can prove ownership of entries while keeping contents private.

## Key Advantages

- **Encrypted key custody on-chain:** the ledger key is stored as an encrypted `eaddress` using FHEVM.
- **User-authorized decryption:** decrypting the ledger key requires an EIP-712 signature and Zama relayer flow.
- **No plaintext on-chain:** only ciphertext strings and timestamps are stored.
- **Simple UX:** create, unlock, store, and read in a single interface.
- **No server, no localstorage:** all cryptography happens in-memory in the browser.

## How It Works (End-to-End)

1. **Create ledger**
   - The client generates a random EVM address `A` locally (not a wallet, just a key seed).
   - The Zama relayer SDK encrypts `A` into an `externalEaddress` handle and proof.
   - `createLedger` stores the encrypted key and grants access to the owner.
2. **Unlock ledger**
   - The client reads the encrypted key from the contract.
   - The user signs an EIP-712 message to authorize decryption.
   - The Zama relayer returns the clear address `A`, stored only in memory.
3. **Store a message**
   - The client derives an AES-GCM key from `SHA-256(A)` and encrypts the plaintext.
   - Ciphertext format: `sl1:<iv_base64>:<cipher_base64>`.
   - `storeEntry` persists the ciphertext string and timestamp on-chain.
4. **Read and decrypt**
   - The client reads pouch entries and decrypts them locally using `A`.
   - No plaintext or keys ever touch the chain.

## Architecture Overview

### Smart Contract (SilentLedger)

- **Ledger state**
  - `hasLedger(owner)` tracks whether a user created a ledger.
  - `getLedgerKey(owner)` returns the encrypted `eaddress`.
- **Pouch storage**
  - `storeEntry(ciphertext)` appends a string + timestamp.
  - `getEntryCount(owner)` and `getEntry(owner, index)` read entries.
- **Key management**
  - `createLedger(encryptedKey, inputProof)` stores the initial key.
  - `rotateLedgerKey(encryptedKey, inputProof)` replaces the key.
- **Events**
  - `LedgerCreated`, `LedgerKeyRotated`, `EntryStored`.
- **FHE permissions**
  - `FHE.allowThis` and `FHE.allow` ensure the owner can decrypt.

### Frontend (home/)

- React + Vite UI with a single-page ledger flow.
- `viem` is used for reads, `ethers` for writes.
- The UI loads the latest 25 entries for readability and performance.
- Decryption is triggered only after unlocking the ledger key.

### Cryptography Details

- **Ledger key**: random EVM address generated locally with `ethers.Wallet.createRandom()`.
- **Key storage**: encrypted `eaddress` stored on-chain via Zama FHEVM.
- **Message encryption**: AES-GCM, 12-byte IV, Base64 encoding.
- **Key derivation**: `SHA-256(addressBytes)` to form the AES key.
- **Decryption authorization**: EIP-712 signature with a 10-day validity window.

## Tech Stack

- **Contracts**: Solidity 0.8.27, Hardhat, hardhat-deploy, TypeChain, ethers v6
- **FHE**: Zama FHEVM (Solidity library + relayer SDK)
- **Frontend**: React, Vite, TypeScript, wagmi, RainbowKit, viem, custom CSS
- **Crypto**: Web Crypto API (AES-GCM, SHA-256), EIP-712 signatures
- **Network**: Sepolia (chainId 11155111), Infura or public RPC

## Project Structure

```
.
├── contracts/            # Solidity contracts (SilentLedger + FHECounter example)
├── deploy/               # Deployment scripts (hardhat-deploy)
├── deployments/          # Deployment artifacts (ABI + addresses)
├── tasks/                # Hardhat tasks (CLI helpers + ABI sync)
├── test/                 # Hardhat tests (local + Sepolia)
├── home/                 # React frontend
└── hardhat.config.ts     # Hardhat configuration
```

## Setup and Usage

### Prerequisites

- Node.js 20+
- npm

### Install (contracts + tasks)

```bash
npm install
```

### Environment Variables (deploy only)

Create a `.env` file with:

- `PRIVATE_KEY` (required, no mnemonic)
- `INFURA_API_KEY` (recommended for Sepolia RPC)
- `ETHERSCAN_API_KEY` (optional, for verification)

### Compile and Test

```bash
npm run compile
npm run test
```

### Local Development (contracts only)

```bash
npx hardhat node
npx hardhat deploy --network localhost
```

The frontend does not use localhost networks. It is built for Sepolia.

### Deploy to Sepolia

```bash
npx hardhat deploy --network sepolia
```

### Sync ABI to Frontend

The frontend ABI must come from `deployments/sepolia`. Use:

```bash
npx hardhat --network sepolia task:sync-frontend
```

This writes `home/src/config/silentLedger.ts` with the ABI and default address.

### Run the Frontend

```bash
cd home
npm install
npm run dev
```

Open the app, connect a wallet on Sepolia, and confirm the contract address.

## CLI Tasks (optional)

```bash
# Print deployed contract address
npx hardhat task:silent-ledger:address --network sepolia

# Create a ledger (optionally pass a plaintext key address)
npx hardhat task:silent-ledger:create-ledger --network sepolia --key 0x...

# Decrypt the ledger key for an owner
npx hardhat task:silent-ledger:decrypt-key --network sepolia --owner 0x...

# Store a ciphertext string directly
npx hardhat task:silent-ledger:store-entry --network sepolia --ciphertext sl1:...

# List entries for an owner
npx hardhat task:silent-ledger:list-entries --network sepolia --owner 0x...
```

## Security and Privacy Notes

- The ledger key is encrypted on-chain and only decryptable by the owner.
- Ciphertext strings are not validated on-chain; the client must produce valid payloads.
- The decrypted key is kept in memory only and cleared when "Lock" is used.
- If the clear key is exposed, all entries for that ledger can be decrypted.
- On-chain storage is public and permanent; privacy relies on encryption strength.

## Limitations

- On-chain string storage can be expensive for large data.
- The UI loads the latest 25 entries; large ledgers may need pagination or indexing.
- No server-side indexing or search.
- Availability depends on the Zama relayer service for decryption.

## Future Roadmap

- Ledger key rotation UX and recovery flows.
- Pagination, search, and event-based indexing.
- Multi-device safe export and import of ledger keys.
- Rich payload types (files, metadata, structured notes).
- Additional networks beyond Sepolia when FHEVM support expands.
- Gas and storage optimizations for large pouches.

## License

BSD-3-Clause-Clear. See `LICENSE`.

## References

- Zama FHEVM docs: `docs/zama_llm.md`
- Zama relayer SDK docs: `docs/zama_doc_relayer.md`
