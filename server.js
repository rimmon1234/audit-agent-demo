import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import multer from "multer";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// 1. Storage Setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "contracts/";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const originalName = file.originalname;
    cb(null, Date.now() + "-" + originalName);
  }
});

const upload = multer({
  storage,
  fileFilter: function (req, file, cb) {
    if (path.extname(file.originalname) !== ".sol") {
      return cb(new Error("Only Solidity files allowed"));
    }
    cb(null, true);
  }
});

// 2. Logic Imports
import { verifyPayment, getPaymentRequest, calculatePrice } from "./payments/facinetPayment.js";
import { build402Response } from "./payments/x402.js";
import { audit } from "./agent/auditAgent.js";
import { uploadAuditToIPFS } from "./blockchain/ipfsUploader.js";
import { storeAuditOnChain } from "./blockchain/registryWriter.js";

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "frontend")));

const SUPPORTED_NETWORKS = ["base-sepolia", "avalanche-fuji"];
const PORT = process.env.PORT || 3000;

/* --- Internal Payment (Server Pays Fee) --- */
app.post("/pay", async (req, res) => {
  try {
    const { amount, network } = req.body;

    if (!network || !SUPPORTED_NETWORKS.includes(network)) {
      return res.status(400).json({ error: "Invalid or missing network" });
    }

    if (!process.env.PAYER_PRIVATE_KEY) {
      throw new Error("PAYER_PRIVATE_KEY missing in .env");
    }

    const { Facinet } = await import("facinet");
    const facinet = new Facinet({
      privateKey: process.env.PAYER_PRIVATE_KEY,
      network: network
    });

    const paymentResult = await facinet.pay({
      amount: amount || process.env.PAYMENT_AMOUNT || "1.00",
      recipient: process.env.RECEIVING_WALLET
    });

    console.log(`[PAYMENT] Sponsored Success: ${amount} USDC on ${network}`);
    res.json({ ...paymentResult, network });

  } catch (err) {
    console.error("PAYMENT FAIL:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/*
----------------------------------
Audit Endpoint
----------------------------------
*/
app.post("/audit", async (req, res) => {
  let contractPath = null;

  try {
    const paymentHeader = req.headers["x-payment"];
    const network = req.headers["x-network"] || "base-sepolia";

    // Validate network
    if (!SUPPORTED_NETWORKS.includes(network)) {
      return res.status(400).json({ error: "Invalid network" });
    }

    // Check payment BEFORE saving file
    if (!paymentHeader) {
      // Need to process file first to calculate price
      await new Promise((resolve, reject) => {
        upload.single("contract")(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      if (!req.file) {
        return res.status(400).json({ error: "No contract file uploaded" });
      }

      contractPath = req.file.path;
      const content = fs.readFileSync(contractPath, "utf8");
      const lineCount = content.split("\n").filter(l => l.trim() !== "").length;
      const requiredAmount = calculatePrice(lineCount);

      const paymentRequest = getPaymentRequest(requiredAmount, network);
      
      // Cleanup file before returning 402
      if (contractPath && fs.existsSync(contractPath)) {
        fs.unlinkSync(contractPath);
        contractPath = null;
      }

      return res
        .status(402)
        .header("Payment-Required", build402Response(paymentRequest))
        .json({ 
          error: "Payment required", 
          code: 402,
          amount: requiredAmount, 
          lineCount,
          network 
        });
    }

    // Only save file if payment header exists (for retry after payment)
    await new Promise((resolve, reject) => {
      upload.single("contract")(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (!req.file) {
      return res.status(400).json({ error: "No contract file uploaded" });
    }

    contractPath = req.file.path;
    const contractName = req.file.originalname;

    // Calculate expected amount based on line count
    const content = fs.readFileSync(contractPath, "utf8");
    const lineCount = content.split("\n").filter(l => l.trim() !== "").length;
    const requiredAmount = calculatePrice(lineCount);

    // Decode and verify payment
    const paymentData = JSON.parse(
      Buffer.from(paymentHeader, "base64").toString("utf8")
    );

    const isPaid = await verifyPayment(paymentData, requiredAmount);

    if (!isPaid) {
      return res.status(402).json({ 
        error: "Payment verification failed",
        required: requiredAmount,
        lineCount 
      });
    }

    console.log(`Running audit on: ${contractPath} (network: ${network}, lines: ${lineCount})`);

    // Step 1: Run audit
    const report = await audit(contractPath);
    console.log("Audit complete");

    // Step 2: Upload to IPFS
    console.log("Uploading to IPFS...");
    const ipfsCid = await uploadAuditToIPFS(contractPath, report, paymentData);

    // Step 3: Store on chain
    console.log("Storing on chain...");
    const chainResult = await storeAuditOnChain(
      contractName,
      report.securityScore,
      ipfsCid,
      network
    );

    res.json({
      success: true,
      network,
      report,
      ipfs: {
        cid: ipfsCid,
        url: `${process.env.PINATA_GATEWAY}/ipfs/${ipfsCid}`
      },
      blockchain: {
        txHash: chainResult.txHash,
        blockNumber: chainResult.blockNumber,
        explorerUrl: chainResult.explorerUrl
      },
      stats: { 
        lineCount, 
        amountPaid: requiredAmount 
      }
    });

  } catch (err) {
    console.error("AUDIT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    // Cleanup uploaded file
    if (contractPath && fs.existsSync(contractPath)) {
      try {
        fs.unlinkSync(contractPath);
        console.log(`Successfully purged: ${contractPath}`);
      } catch (cleanupErr) {
        console.error("Cleanup failed:", cleanupErr.message);
      }
    }
  }
});

app.listen(PORT, () => console.log(`🚀 Auditor running on http://localhost:${PORT}`));