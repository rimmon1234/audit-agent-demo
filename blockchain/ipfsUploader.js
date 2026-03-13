import axios from "axios";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

export async function uploadAuditToIPFS(contractPath, report, paymentInfo) {
  try {
    const contractSource = fs.readFileSync(contractPath, "utf8");
    const contractName = contractPath.split("/").pop();

    const auditBundle = {
      metadata: {
        contractName,
        timestamp: new Date().toISOString(),
        network: process.env.NETWORK || "base-sepolia"
      },
      contractSource,
      auditReport: {
        securityScore: report.securityScore,
        vulnerabilities: report.vulnerabilities,
        aiAnalysis: report.aiAnalysis
      },
      paymentInfo: {
        network: paymentInfo.network,
        chainId: paymentInfo.chainId,
        usdcAddress: paymentInfo.usdcAddress,
        facilitatorId: paymentInfo.facilitator?.id,
        facilitatorName: paymentInfo.facilitator?.name,
        from: paymentInfo.payment?.from,
        to: paymentInfo.payment?.to,
        value: paymentInfo.payment?.amount,
        txHash: paymentInfo.txHash
      }
    };

    const response = await axios.post(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      {
        pinataContent: auditBundle,
        pinataMetadata: {
          name: `audit-${contractName}-${Date.now()}`
        }
      },
      {
        headers: {
          pinata_api_key: process.env.PINATA_API_KEY,
          pinata_secret_api_key: process.env.PINATA_API_SECRET,
          "Content-Type": "application/json"
        }
      }
    );

    const cid = response.data.IpfsHash;
    console.log("Uploaded to IPFS, CID:", cid);
    return cid;

  } catch (err) {
    console.error("IPFS upload failed:", err.message);
    throw err;
  }
}