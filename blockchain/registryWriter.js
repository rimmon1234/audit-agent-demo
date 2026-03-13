import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const ABI = [
  "function storeAudit(string memory _contractName, uint256 _securityScore, string memory _ipfsCid) public",
  "function totalAudits() public view returns (uint256)",
  "function getAudit(uint256 index) public view returns (address, string memory, uint256, string memory, uint256)"
];

export async function storeAuditOnChain(contractName, securityScore, ipfsCid) {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL);
    const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(
      process.env.AUDIT_REGISTRY_ADDRESS,
      ABI,
      wallet
    );

    console.log("Storing audit on chain...");

    const tx = await contract.storeAudit(
      contractName,
      securityScore,
      ipfsCid
    );

    const receipt = await tx.wait();
    console.log("Stored on chain, tx hash:", receipt.hash);

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber
    };

  } catch (err) {
    console.error("Chain storage failed:", err.message);
    throw err;
  }
}