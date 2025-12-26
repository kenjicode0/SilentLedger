import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { deployments, ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { SilentLedger } from "../types";

type Signers = {
  alice: HardhatEthersSigner;
};

describe("SilentLedgerSepolia", function () {
  let signers: Signers;
  let silentLedger: SilentLedger;
  let silentLedgerAddress: string;
  let step: number;
  let steps: number;

  function progress(message: string) {
    console.log(`${++step}/${steps} ${message}`);
  }

  before(async function () {
    if (fhevm.isMock) {
      console.warn(`This hardhat test suite can only run on Sepolia Testnet`);
      this.skip();
    }

    try {
      const deployment = await deployments.get("SilentLedger");
      silentLedgerAddress = deployment.address;
      silentLedger = await ethers.getContractAt("SilentLedger", deployment.address);
    } catch (e) {
      (e as Error).message += ". Call 'npx hardhat deploy --network sepolia'";
      throw e;
    }

    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { alice: ethSigners[0] };
  });

  beforeEach(async () => {
    step = 0;
    steps = 0;
  });

  it("creates/rotates a ledger key and stores an entry", async function () {
    steps = 12;
    this.timeout(6 * 40000);

    await fhevm.initializeCLIApi();

    progress("Checking ledger existence...");
    const has = await silentLedger.hasLedger(signers.alice.address);

    progress("Encrypting new ledger key address...");
    const clearKeyAddress = ethers.Wallet.createRandom().address;
    const encryptedKey = await fhevm
      .createEncryptedInput(silentLedgerAddress, signers.alice.address)
      .addAddress(clearKeyAddress)
      .encrypt();

    if (!has) {
      progress("Creating ledger...");
      const tx = await silentLedger
        .connect(signers.alice)
        .createLedger(encryptedKey.handles[0], encryptedKey.inputProof);
      await tx.wait();
    } else {
      progress("Rotating ledger key...");
      const tx = await silentLedger
        .connect(signers.alice)
        .rotateLedgerKey(encryptedKey.handles[0], encryptedKey.inputProof);
      await tx.wait();
    }

    progress("Fetching encrypted ledger key...");
    const encryptedStoredKey = await silentLedger.getLedgerKey(signers.alice.address);
    expect(encryptedStoredKey).to.not.eq(ethers.ZeroHash);

    progress("Decrypting ledger key...");
    const decryptedKeyAddress = await fhevm.userDecryptEaddress(encryptedStoredKey, silentLedgerAddress, signers.alice);
    progress(`Decrypted key: ${decryptedKeyAddress}`);
    expect(decryptedKeyAddress.toLowerCase()).to.eq(clearKeyAddress.toLowerCase());

    progress("Storing an entry...");
    const ciphertext = `ciphertext:${Date.now()}`;
    const storeTx = await silentLedger.connect(signers.alice).storeEntry(ciphertext);
    await storeTx.wait();

    progress("Reading entry count...");
    const count = await silentLedger.getEntryCount(signers.alice.address);
    expect(count).to.be.greaterThan(0);
  });
});

