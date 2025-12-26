import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("task:silent-ledger:address", "Prints the SilentLedger address").setAction(async function (_taskArgs: TaskArguments, hre) {
  const deployment = await hre.deployments.get("SilentLedger");
  console.log(`SilentLedger address is ${deployment.address}`);
});

task("task:silent-ledger:create-ledger", "Creates a ledger for the caller")
  .addOptionalParam("address", "Optionally specify the SilentLedger contract address")
  .addOptionalParam("key", "Optional plaintext key address (defaults to a random address)")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers: hreEthers, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const deployment = taskArgs.address ? { address: taskArgs.address } : await deployments.get("SilentLedger");
    const contractAddress = deployment.address;

    const [signer] = await hreEthers.getSigners();

    const keyAddress: string = taskArgs.key ? String(taskArgs.key) : hreEthers.Wallet.createRandom().address;
    if (!hreEthers.isAddress(keyAddress)) {
      throw new Error(`Invalid --key address: ${keyAddress}`);
    }

    const silentLedger = await hreEthers.getContractAt("SilentLedger", contractAddress);

    const encryptedInput = await fhevm.createEncryptedInput(contractAddress, signer.address).addAddress(keyAddress).encrypt();

    const tx = await silentLedger.connect(signer).createLedger(encryptedInput.handles[0], encryptedInput.inputProof);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);

    console.log(`Ledger created. Plaintext key address: ${keyAddress}`);
  });

task("task:silent-ledger:decrypt-key", "Decrypts the encrypted ledger key for an owner")
  .addOptionalParam("address", "Optionally specify the SilentLedger contract address")
  .addOptionalParam("owner", "Owner address (defaults to the first signer)")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers: hreEthers, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const deployment = taskArgs.address ? { address: taskArgs.address } : await deployments.get("SilentLedger");
    const contractAddress = deployment.address;

    const [signer] = await hreEthers.getSigners();
    const owner: string = taskArgs.owner ? String(taskArgs.owner) : signer.address;
    if (!hreEthers.isAddress(owner)) {
      throw new Error(`Invalid --owner address: ${owner}`);
    }

    const silentLedger = await hreEthers.getContractAt("SilentLedger", contractAddress);
    const encryptedKey = await silentLedger.getLedgerKey(owner);

    const clearKeyAddress = await fhevm.userDecryptEaddress(encryptedKey, contractAddress, signer);
    console.log(`Encrypted key: ${encryptedKey}`);
    console.log(`Clear key    : ${clearKeyAddress}`);
  });

task("task:silent-ledger:store-entry", "Stores a ciphertext string in the caller's pouch")
  .addOptionalParam("address", "Optionally specify the SilentLedger contract address")
  .addParam("ciphertext", "Ciphertext string to store")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers: hreEthers } = hre;

    const deployment = taskArgs.address ? { address: taskArgs.address } : await deployments.get("SilentLedger");
    const contractAddress = deployment.address;

    const [signer] = await hreEthers.getSigners();
    const silentLedger = await hreEthers.getContractAt("SilentLedger", contractAddress);

    const tx = await silentLedger.connect(signer).storeEntry(String(taskArgs.ciphertext));
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

task("task:silent-ledger:list-entries", "Lists pouch entries for an owner")
  .addOptionalParam("address", "Optionally specify the SilentLedger contract address")
  .addOptionalParam("owner", "Owner address (defaults to the first signer)")
  .setAction(async function (taskArgs: TaskArguments, hre) {
    const { deployments, ethers: hreEthers } = hre;

    const deployment = taskArgs.address ? { address: taskArgs.address } : await deployments.get("SilentLedger");
    const contractAddress = deployment.address;

    const [signer] = await hreEthers.getSigners();
    const owner: string = taskArgs.owner ? String(taskArgs.owner) : signer.address;
    if (!hreEthers.isAddress(owner)) {
      throw new Error(`Invalid --owner address: ${owner}`);
    }

    const silentLedger = await hreEthers.getContractAt("SilentLedger", contractAddress);

    const count = await silentLedger.getEntryCount(owner);
    console.log(`Entry count: ${count}`);

    const limit = Number(count);
    for (let i = 0; i < limit; i++) {
      const [createdAt, ciphertext] = await silentLedger.getEntry(owner, i);
      console.log(`${i}: createdAt=${createdAt.toString()} ciphertext=${ciphertext}`);
    }
  });
