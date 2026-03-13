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

const storage = multer.diskStorage({
    destination: function (req, file, cb) { 
        cb(null, "contracts/"); 
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

import { verifyPayment, getPaymentRequest } from "./payments/facinetPayment.js";
import { build402Response } from "./payments/x402.js";
import { audit } from "./agent/auditAgent.js";
import { uploadAuditToIPFS } from "./blockchain/ipfsUploader.js";
import { storeAuditOnChain } from "./blockchain/registryWriter.js";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "frontend")));

const PORT = process.env.PORT || 8000;

/*
----------------------------------
Health check
----------------------------------
*/
app.get("/", (req, res) => {
  res.json({ message: "AI Smart Contract Auditor API running" });
});

/*
----------------------------------
Payment Endpoint
----------------------------------
*/
app.post("/pay", async (req, res) => {
  try {
    const { Facinet } = await import("facinet");

    const facinet = new Facinet({
      privateKey: process.env.PAYER_PRIVATE_KEY,
      network: process.env.NETWORK || "base-sepolia"
    });

    const paymentResult = await facinet.pay({
      amount: process.env.PAYMENT_AMOUNT || "1",
      recipient: process.env.RECEIVING_WALLET
    });

    console.log("Payment completed\n");
    res.json(paymentResult);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/*
----------------------------------
Audit Endpoint
----------------------------------
*/
app.post("/audit", upload.single("contract"), async (req, res) => {
  let contractPath = req.file ? req.file.path : null; // Track path for cleanup

  try {
    const paymentHeader = req.headers["x-payment"];

    if (!paymentHeader) {
      const paymentRequest = getPaymentRequest();
      return res.status(402)
        .header("Payment-Required", build402Response(paymentRequest))
        .json({ error: "Payment required", code: 402 });
    }

    // Decode and Verify Payment
    const paymentData = JSON.parse(Buffer.from(paymentHeader, "base64").toString("utf8"));
    const paid = await verifyPayment(paymentData);

    if (!paid) return res.status(402).json({ error: "Invalid payment" });
    if (!req.file) return res.status(400).json({ error: "No contract file uploaded" });

    const contractName = req.file.originalname;
    
    // Step 1: Run audit
    const report = await audit(contractPath);

    // Step 2: Upload to IPFS
    const ipfsCid = await uploadAuditToIPFS(contractPath, report, paymentData);

    // Step 3: Store on chain
    const chainResult = await storeAuditOnChain(
      contractName,
      report.securityScore,
      ipfsCid
    );

    res.json({
      success: true,
      report,
      ipfs: { cid: ipfsCid, url: `${process.env.PINATA_GATEWAY}/ipfs/${ipfsCid}` },
      blockchain: {
        txHash: chainResult.txHash,
        explorerUrl: `https://sepolia.basescan.org/tx/${chainResult.txHash}`
      }
    });

  } catch (err) {
    console.error("AUDIT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    // --- THE CLEANUP LOGIC ---
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

/*
----------------------------------
Start server
----------------------------------
*/
app.listen(PORT, () => {
  console.log(`Audit server running on port ${PORT}`);
});