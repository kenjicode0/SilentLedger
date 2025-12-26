import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { Contract, ethers } from 'ethers';

import { Header } from './Header';
import '../styles/LedgerApp.css';

import { DEFAULT_SILENT_LEDGER_ADDRESS, SILENT_LEDGER_ABI } from '../config/silentLedger';
import { publicClient } from '../lib/publicClient';
import { decryptWithAddressKey, encryptWithAddressKey } from '../lib/ledgerCrypto';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';

type Entry = {
  index: number;
  createdAt: bigint;
  ciphertext: string;
  plaintext?: string;
  decryptError?: string;
};

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
function isAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

function shortHex(value: string, size = 6): string {
  if (value.length <= size * 2 + 2) return value;
  return `${value.slice(0, size + 2)}…${value.slice(-size)}`;
}

export function LedgerApp() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [contractAddress, setContractAddress] = useState<string>(DEFAULT_SILENT_LEDGER_ADDRESS);
  const [hasLedger, setHasLedger] = useState<boolean>(false);
  const [encryptedLedgerKey, setEncryptedLedgerKey] = useState<`0x${string}` | null>(null);
  const [ledgerKeyAddress, setLedgerKeyAddress] = useState<string | null>(null);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [entryCount, setEntryCount] = useState<bigint>(0n);

  const [message, setMessage] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [isUnlocking, setIsUnlocking] = useState<boolean>(false);
  const [isStoring, setIsStoring] = useState<boolean>(false);

  const isOnSepolia = chainId === 11155111;

  const isContractAddressValid = useMemo(() => isAddress(contractAddress), [contractAddress]);
  const isContractAddressUnset = contractAddress.toLowerCase() === DEFAULT_SILENT_LEDGER_ADDRESS.toLowerCase();

  const clearMessages = useCallback(() => {
    setStatus('');
    setError('');
  }, []);

  const refresh = useCallback(async () => {
    clearMessages();

    if (!isConnected || !address) return;
    if (!isContractAddressValid) {
      setError('Enter a valid contract address.');
      return;
    }

    setIsRefreshing(true);
    try {
      const has = (await publicClient.readContract({
        address: contractAddress as `0x${string}`,
        abi: SILENT_LEDGER_ABI,
        functionName: 'hasLedger',
        args: [address as `0x${string}`],
      })) as boolean;

      setHasLedger(has);

      if (!has) {
        setEncryptedLedgerKey(null);
        setLedgerKeyAddress(null);
        setEntryCount(0n);
        setEntries([]);
        return;
      }

      const encryptedKey = (await publicClient.readContract({
        address: contractAddress as `0x${string}`,
        abi: SILENT_LEDGER_ABI,
        functionName: 'getLedgerKey',
        args: [address as `0x${string}`],
      })) as `0x${string}`;

      setEncryptedLedgerKey(encryptedKey);

      const count = (await publicClient.readContract({
        address: contractAddress as `0x${string}`,
        abi: SILENT_LEDGER_ABI,
        functionName: 'getEntryCount',
        args: [address as `0x${string}`],
      })) as bigint;
      setEntryCount(count);

      const safeCount = Number(count);
      const max = 25;
      const start = Math.max(0, safeCount - max);
      const indices = Array.from({ length: safeCount - start }, (_, i) => start + i);

      const pouch = await Promise.all(
        indices.map(async (index) => {
          const [createdAt, ciphertext] = (await publicClient.readContract({
            address: contractAddress as `0x${string}`,
            abi: SILENT_LEDGER_ABI,
            functionName: 'getEntry',
            args: [address as `0x${string}`, BigInt(index)],
          })) as [bigint, string];
          return { index, createdAt, ciphertext } satisfies Entry;
        }),
      );

      setEntries(pouch);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to refresh ledger data.');
    } finally {
      setIsRefreshing(false);
    }
  }, [address, clearMessages, contractAddress, isConnected, isContractAddressValid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    if (!ledgerKeyAddress) {
      const hasDecryptedData = entries.some((entry) => entry.plaintext !== undefined || entry.decryptError !== undefined);
      if (!hasDecryptedData) {
        return;
      }
      setEntries((prev) => prev.map((e) => ({ ...e, plaintext: undefined, decryptError: undefined })));
      return;
    }

    const needsDecrypt = entries.some((e) => e.plaintext === undefined && e.decryptError === undefined);
    if (!needsDecrypt) return;

    const decryptAll = async () => {
      const updated = await Promise.all(
        entries.map(async (entry) => {
          if (entry.plaintext !== undefined || entry.decryptError !== undefined) return entry;
          try {
            const plaintext = await decryptWithAddressKey(entry.ciphertext, ledgerKeyAddress);
            return { ...entry, plaintext, decryptError: undefined };
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Decryption failed';
            return { ...entry, plaintext: undefined, decryptError: message };
          }
        }),
      );

      if (!cancelled) setEntries(updated);
    };

    void decryptAll();
    return () => {
      cancelled = true;
    };
  }, [entryCount, ledgerKeyAddress]);

  const createLedger = useCallback(async () => {
    clearMessages();
    if (!instance || !address || !signerPromise) {
      setError('Connect a wallet and wait for the encryption service to be ready.');
      return;
    }
    if (!isOnSepolia) {
      setError('Switch your wallet network to Sepolia.');
      return;
    }
    if (!isContractAddressValid) {
      setError('Enter a valid contract address.');
      return;
    }
    if (isContractAddressUnset) {
      setError('Set the deployed contract address first.');
      return;
    }

    setIsCreating(true);
    try {
      const signer = await signerPromise;
      const contract = new Contract(contractAddress, SILENT_LEDGER_ABI, signer);

      const keyAddress = ethers.Wallet.createRandom().address;
      const input = instance.createEncryptedInput(contractAddress, address);
      input.addAddress(keyAddress);
      const encryptedInput = await input.encrypt();

      const handle0 = ethers.hexlify(encryptedInput.handles[0]);
      const tx = await contract.createLedger(handle0, encryptedInput.inputProof);
      setStatus(`Transaction submitted: ${tx.hash}`);
      await tx.wait();

      setStatus('Ledger created.');
      await refresh();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to create ledger.');
    } finally {
      setIsCreating(false);
    }
  }, [
    address,
    clearMessages,
    contractAddress,
    instance,
    isContractAddressUnset,
    isContractAddressValid,
    isOnSepolia,
    refresh,
    signerPromise,
  ]);

  const unlockLedger = useCallback(async () => {
    clearMessages();
    if (!instance || !address || !signerPromise) {
      setError('Connect a wallet and wait for the encryption service to be ready.');
      return;
    }
    if (!encryptedLedgerKey) {
      setError('Ledger key not found. Create a ledger first.');
      return;
    }
    if (!isOnSepolia) {
      setError('Switch your wallet network to Sepolia.');
      return;
    }
    if (!isContractAddressValid || isContractAddressUnset) {
      setError('Set a valid deployed contract address first.');
      return;
    }

    setIsUnlocking(true);
    try {
      const signer = await signerPromise;
      const keypair = instance.generateKeypair();

      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [contractAddress];

      const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);
      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message,
      );

      const result = await instance.userDecrypt(
        [{ handle: encryptedLedgerKey, contractAddress }],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace(/^0x/, ''),
        contractAddresses,
        address,
        startTimeStamp,
        durationDays,
      );

      const clearKey = result[encryptedLedgerKey];
      if (typeof clearKey !== 'string' || !isAddress(clearKey)) {
        throw new Error('Unexpected decrypted key type.');
      }

      setLedgerKeyAddress(clearKey);
      setStatus('Ledger unlocked.');
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to unlock ledger.');
    } finally {
      setIsUnlocking(false);
    }
  }, [
    address,
    clearMessages,
    contractAddress,
    encryptedLedgerKey,
    instance,
    isContractAddressUnset,
    isContractAddressValid,
    isOnSepolia,
    signerPromise,
  ]);

  const lockLedger = useCallback(() => {
    clearMessages();
    setLedgerKeyAddress(null);
    setStatus('Ledger locked.');
  }, [clearMessages]);

  const storeMessage = useCallback(async () => {
    clearMessages();

    if (!ledgerKeyAddress) {
      setError('Unlock your ledger key first.');
      return;
    }
    if (!instance || !address || !signerPromise) {
      setError('Connect a wallet and wait for the encryption service to be ready.');
      return;
    }
    if (!isOnSepolia) {
      setError('Switch your wallet network to Sepolia.');
      return;
    }
    if (!isContractAddressValid || isContractAddressUnset) {
      setError('Set a valid deployed contract address first.');
      return;
    }
    if (!message.trim()) {
      setError('Enter a message.');
      return;
    }

    setIsStoring(true);
    try {
      const signer = await signerPromise;
      const contract = new Contract(contractAddress, SILENT_LEDGER_ABI, signer);

      const ciphertext = await encryptWithAddressKey(message.trim(), ledgerKeyAddress);
      const tx = await contract.storeEntry(ciphertext);
      setStatus(`Transaction submitted: ${tx.hash}`);
      await tx.wait();

      setMessage('');
      setStatus('Entry stored.');
      await refresh();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to store entry.');
    } finally {
      setIsStoring(false);
    }
  }, [
    address,
    clearMessages,
    contractAddress,
    instance,
    isContractAddressUnset,
    isContractAddressValid,
    isOnSepolia,
    ledgerKeyAddress,
    message,
    refresh,
    signerPromise,
  ]);

  return (
    <div className="ledger-shell">
      <Header />

      <div className="ledger-container">
        <div className="ledger-grid">
          <section className="ledger-card">
            <h2 className="ledger-card-title">Contract</h2>

            <label className="ledger-label" htmlFor="contractAddress">
              SilentLedger address (Sepolia)
            </label>
            <input
              id="contractAddress"
              className="ledger-input mono"
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value.trim())}
              placeholder="0x..."
              spellCheck={false}
              autoComplete="off"
              inputMode="text"
            />

            {isContractAddressUnset ? (
              <div className="ledger-callout warning">
                Set the deployed `SilentLedger` contract address. After deploying to Sepolia, you can run `npx hardhat --network sepolia task:sync-frontend` to
                auto-fill this field by default.
              </div>
            ) : null}

            <div className="ledger-row">
              <button className="ledger-button secondary" onClick={() => void refresh()} disabled={!isConnected || isRefreshing}>
                {isRefreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              <div className="ledger-hint">
                {isConnected && address ? (
                  <>
                    <span>Wallet:</span> <span className="mono">{shortHex(address)}</span>
                  </>
                ) : (
                  <span>Connect a wallet to continue.</span>
                )}
              </div>
            </div>

            {!isOnSepolia && isConnected ? (
              <div className="ledger-callout warning">Switch your wallet network to Sepolia (chainId 11155111).</div>
            ) : null}

            {zamaLoading ? <div className="ledger-callout info">Initializing encryption service…</div> : null}
            {zamaError ? <div className="ledger-callout error">{zamaError}</div> : null}
            {status ? <div className="ledger-callout success">{status}</div> : null}
            {error ? <div className="ledger-callout error">{error}</div> : null}
          </section>

          <section className="ledger-card">
            <h2 className="ledger-card-title">Ledger Key</h2>

            <div className="ledger-row">
              <div className="ledger-stat">
                <div className="ledger-stat-label">Ledger created</div>
                <div className="ledger-stat-value">{hasLedger ? 'Yes' : 'No'}</div>
              </div>
              <div className="ledger-stat">
                <div className="ledger-stat-label">Unlocked</div>
                <div className="ledger-stat-value">{ledgerKeyAddress ? 'Yes' : 'No'}</div>
              </div>
            </div>

            <div className="ledger-row">
              <button className="ledger-button" onClick={() => void createLedger()} disabled={!isConnected || isCreating || zamaLoading}>
                {isCreating ? 'Creating…' : 'Create Ledger'}
              </button>
              <button
                className="ledger-button"
                onClick={() => void unlockLedger()}
                disabled={!isConnected || isUnlocking || zamaLoading || !hasLedger}
              >
                {isUnlocking ? 'Unlocking…' : 'Unlock Ledger'}
              </button>
              <button className="ledger-button secondary" onClick={lockLedger} disabled={!ledgerKeyAddress}>
                Lock
              </button>
            </div>

            <div className="ledger-block">
              <div className="ledger-label">Encrypted key handle</div>
              <div className="mono">{encryptedLedgerKey ?? '—'}</div>
            </div>

            <div className="ledger-block">
              <div className="ledger-label">Decrypted key address</div>
              <div className="mono">{ledgerKeyAddress ?? '—'}</div>
            </div>
          </section>
        </div>

        <section className="ledger-card ledger-section">
          <h2 className="ledger-card-title">Pouch</h2>

          <div className="ledger-row">
            <div className="ledger-stat">
              <div className="ledger-stat-label">Entry count</div>
              <div className="ledger-stat-value">{entryCount.toString()}</div>
            </div>
            <div className="ledger-hint">Stores ciphertext strings on-chain. Decryption happens locally after unlocking.</div>
          </div>

          <div className="ledger-row">
            <input
              className="ledger-input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write a message to encrypt and store…"
              disabled={!ledgerKeyAddress}
            />
            <button className="ledger-button" onClick={() => void storeMessage()} disabled={isStoring || !ledgerKeyAddress}>
              {isStoring ? 'Storing…' : 'Store'}
            </button>
          </div>

          <div className="ledger-entries">
            {entries.length === 0 ? (
              <div className="ledger-empty">No entries loaded.</div>
            ) : (
              entries
                .slice()
                .reverse()
                .map((entry) => {
                  const ts = Number(entry.createdAt) * 1000;
                  const when = Number.isFinite(ts) ? new Date(ts).toLocaleString() : entry.createdAt.toString();
                  return (
                    <div key={entry.index} className="ledger-entry">
                      <div className="ledger-row entry-header">
                        <div className="mono">#{entry.index}</div>
                        <div className="ledger-hint">{when}</div>
                      </div>

                      <div className="ledger-block">
                        <div className="ledger-label">Ciphertext</div>
                        <div className="mono">{entry.ciphertext}</div>
                      </div>

                      <div className="ledger-block">
                        <div className="ledger-label">Plaintext</div>
                        {!ledgerKeyAddress ? (
                          <div className="ledger-hint">Unlock the ledger key to decrypt.</div>
                        ) : entry.decryptError ? (
                          <div className="ledger-callout error">{entry.decryptError}</div>
                        ) : entry.plaintext ? (
                          <div className="ledger-plaintext">{entry.plaintext}</div>
                        ) : (
                          <div className="ledger-hint">Decrypting…</div>
                        )}
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
