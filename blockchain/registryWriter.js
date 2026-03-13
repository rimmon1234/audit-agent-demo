import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const ABI = [
  "function storeAudit(string memory _contractName, uint256 _securityScore, string memory _ipfsCid) public",
  "function totalAudits() public view returns (uint256)",
  "function getAudit(uint256 index) public view returns (address, string memory, uint256, string memory, uint256)"
];

const NETWORK_CONFIG = {
  "base-sepolia": {
    rpc: process.env.BASE_SEPOLIA_RPC_URL,
    contractAddress: process.env.AUDIT_REGISTRY_ADDRESS,
    explorerUrl: "https://sepolia.basescan.org/tx"
  },
  "avalanche-fuji": {
    rpc: process.env.FUJI_RPC_URL,
    contractAddress: process.env.FUJI_REGISTRY_ADDRESS,
    explorerUrl: "https://testnet.snowtrace.io/tx"
  }
};

export async function storeAuditOnChain(contractName, securityScore, ipfsCid, network) {
  try {
    const config = NETWORK_CONFIG[network];

    if (!config) {
      throw new Error(`Unsupported network: ${network}`);
    }

    const provider = new ethers.JsonRpcProvider(config.rpc);
    const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(
      config.contractAddress,
      ABI,
      wallet
    );

    console.log(`Storing audit on chain (${network})...`);

    const tx = await contract.storeAudit(
      contractName,
      securityScore,
      ipfsCid
    );

    const receipt = await tx.wait();
    console.log("Stored on chain, tx hash:", receipt.hash);

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      explorerUrl: `${config.explorerUrl}/${receipt.hash}`
    };

  } catch (err) {
    console.error("Chain storage failed:", err.message);
    throw err;
  }
}