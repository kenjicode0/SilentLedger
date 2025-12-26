// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, eaddress, externalEaddress} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title SilentLedger
/// @notice Stores an encrypted per-user ledger key (eaddress) and a public "pouch" of ciphertext messages.
/// @dev Ciphertexts in the pouch are expected to be produced off-chain using the decrypted ledger key.
contract SilentLedger is ZamaEthereumConfig {
    struct PouchEntry {
        uint256 createdAt;
        string ciphertext;
    }

    mapping(address owner => bool) private _hasLedger;
    mapping(address owner => eaddress) private _ledgerKey;
    mapping(address owner => PouchEntry[]) private _pouch;

    event LedgerCreated(address indexed owner);
    event LedgerKeyRotated(address indexed owner);
    event EntryStored(address indexed owner, uint256 indexed index);

    error LedgerAlreadyExists(address owner);
    error LedgerNotFound(address owner);
    error EntryIndexOutOfBounds(address owner, uint256 index);

    /// @notice Returns whether `owner` has created a ledger.
    function hasLedger(address owner) external view returns (bool) {
        return _hasLedger[owner];
    }

    /// @notice Creates a ledger for the caller by storing an encrypted address key.
    /// @param encryptedKey The encrypted address key (external ciphertext handle).
    /// @param inputProof The Zama input proof for the encrypted key.
    function createLedger(externalEaddress encryptedKey, bytes calldata inputProof) external {
        address owner = msg.sender;
        if (_hasLedger[owner]) revert LedgerAlreadyExists(owner);

        eaddress key = FHE.fromExternal(encryptedKey, inputProof);

        _hasLedger[owner] = true;
        _ledgerKey[owner] = key;

        FHE.allowThis(key);
        FHE.allow(key, owner);

        emit LedgerCreated(owner);
    }

    /// @notice Rotates the caller's ledger key.
    /// @param encryptedKey The new encrypted address key (external ciphertext handle).
    /// @param inputProof The Zama input proof for the encrypted key.
    function rotateLedgerKey(externalEaddress encryptedKey, bytes calldata inputProof) external {
        address owner = msg.sender;
        if (!_hasLedger[owner]) revert LedgerNotFound(owner);

        eaddress key = FHE.fromExternal(encryptedKey, inputProof);

        _ledgerKey[owner] = key;

        FHE.allowThis(key);
        FHE.allow(key, owner);

        emit LedgerKeyRotated(owner);
    }

    /// @notice Returns the encrypted ledger key for `owner`.
    /// @dev View functions must not rely on msg.sender for address selection.
    function getLedgerKey(address owner) external view returns (eaddress) {
        if (!_hasLedger[owner]) revert LedgerNotFound(owner);
        return _ledgerKey[owner];
    }

    /// @notice Stores a ciphertext message into the caller's pouch.
    /// @dev The ciphertext is not validated on-chain; it is expected to be produced off-chain.
    function storeEntry(string calldata ciphertext) external {
        address owner = msg.sender;
        if (!_hasLedger[owner]) revert LedgerNotFound(owner);

        _pouch[owner].push(PouchEntry({createdAt: block.timestamp, ciphertext: ciphertext}));

        emit EntryStored(owner, _pouch[owner].length - 1);
    }

    /// @notice Returns the number of pouch entries for `owner`.
    function getEntryCount(address owner) external view returns (uint256) {
        return _pouch[owner].length;
    }

    /// @notice Returns a pouch entry by index for `owner`.
    function getEntry(address owner, uint256 index) external view returns (uint256 createdAt, string memory ciphertext) {
        if (index >= _pouch[owner].length) revert EntryIndexOutOfBounds(owner, index);
        PouchEntry storage entry = _pouch[owner][index];
        return (entry.createdAt, entry.ciphertext);
    }
}

