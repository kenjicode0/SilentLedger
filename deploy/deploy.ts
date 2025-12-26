import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedSilentLedger = await deploy("SilentLedger", {
    from: deployer,
    log: true,
  });

  console.log(`SilentLedger contract: `, deployedSilentLedger.address);
};
export default func;
func.id = "deploy_silentLedger"; // id required to prevent reexecution
func.tags = ["SilentLedger"];
