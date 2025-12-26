import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { SilentLedger, SilentLedger__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("SilentLedger")) as SilentLedger__factory;
  const silentLedger = (await factory.deploy()) as SilentLedger;
  const silentLedgerAddress = await silentLedger.getAddress();
  return { silentLedger, silentLedgerAddress };
}

describe("SilentLedger", function () {
  let signers: Signers;
  let silentLedger: SilentLedger;
  let silentLedgerAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ silentLedger, silentLedgerAddress } = await deployFixture());
  });

  it("starts without a ledger", async function () {
    expect(await silentLedger.hasLedger(signers.alice.address)).to.eq(false);
    await expect(silentLedger.getLedgerKey(signers.alice.address)).to.be.revertedWithCustomError(
      silentLedger,
      "LedgerNotFound",
    );
  });

  it("creates a ledger and decrypts the stored key", async function () {
    await fhevm.initializeCLIApi();

    const clearKeyAddress = ethers.Wallet.createRandom().address;

    const encryptedInput = await fhevm
      .createEncryptedInput(silentLedgerAddress, signers.alice.address)
      .addAddress(clearKeyAddress)
      .encrypt();

    await (await silentLedger.connect(signers.alice).createLedger(encryptedInput.handles[0], encryptedInput.inputProof)).wait();

    expect(await silentLedger.hasLedger(signers.alice.address)).to.eq(true);

    const encryptedKey = await silentLedger.getLedgerKey(signers.alice.address);
    expect(encryptedKey).to.not.eq(ethers.ZeroHash);

    const decryptedKeyAddress = await fhevm.userDecryptEaddress(encryptedKey, silentLedgerAddress, signers.alice);
    expect(decryptedKeyAddress.toLowerCase()).to.eq(clearKeyAddress.toLowerCase());
  });

  it("stores and retrieves pouch entries", async function () {
    await fhevm.initializeCLIApi();

    const clearKeyAddress = ethers.Wallet.createRandom().address;
    const encryptedInput = await fhevm
      .createEncryptedInput(silentLedgerAddress, signers.alice.address)
      .addAddress(clearKeyAddress)
      .encrypt();

    await (await silentLedger.connect(signers.alice).createLedger(encryptedInput.handles[0], encryptedInput.inputProof)).wait();

    const ciphertext1 = "ciphertext:one";
    const ciphertext2 = "ciphertext:two";

    await (await silentLedger.connect(signers.alice).storeEntry(ciphertext1)).wait();
    await (await silentLedger.connect(signers.alice).storeEntry(ciphertext2)).wait();

    expect(await silentLedger.getEntryCount(signers.alice.address)).to.eq(2);

    const [createdAt0, stored0] = await silentLedger.getEntry(signers.alice.address, 0);
    expect(createdAt0).to.not.eq(0);
    expect(stored0).to.eq(ciphertext1);

    const [, stored1] = await silentLedger.getEntry(signers.alice.address, 1);
    expect(stored1).to.eq(ciphertext2);

    await expect(silentLedger.getEntry(signers.alice.address, 2)).to.be.revertedWithCustomError(
      silentLedger,
      "EntryIndexOutOfBounds",
    );

    expect(await silentLedger.getEntryCount(signers.bob.address)).to.eq(0);
  });
});

