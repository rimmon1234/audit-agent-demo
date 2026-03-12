import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import multer from "multer";
import cors from "cors";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "contracts/");
  },
  filename: function (req, file, cb) {

    const uniqueName = Date.now() + ".sol";
    cb(null, uniqueName);

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

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

/*
----------------------------------
Health check
----------------------------------
*/

app.get("/", (req, res) => {
  res.json({
    message: "AI Smart Contract Auditor API running"
  });
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
Audit endpoint
----------------------------------
*/
app.post("/audit", upload.single("contract"), async (req, res) => {

  try {

    const paymentHeader = req.headers["x-payment"];

    console.log("--- /audit hit ---");
    console.log("Payment header present:", !!paymentHeader);

    if (!paymentHeader) {
      const paymentRequest = getPaymentRequest();
      return res
        .status(402)
        .header("Payment-Required", build402Response(paymentRequest))
        .json({ error: "Payment required", code: 402 });
    }

    let paymentData;
    try {
      paymentData = JSON.parse(
        Buffer.from(paymentHeader, "base64").toString("utf8")
      );
      console.log("Payment data decoded successfully");
    } catch (e) {
      console.log("Payment decode error:", e.message);
      return res.status(402).json({ error: "Malformed payment header" });
    }

    const paid = await verifyPayment(paymentData);
    console.log("Payment verified:", paid);

    if (!paid) {
      return res.status(402).json({ error: "Invalid or unverified payment" });
    }

    console.log("File received:", req.file ? req.file.path : "NO FILE");

    if (!req.file) {
      return res.status(400).json({ error: "No contract file uploaded" });
    }

    const contractPath = req.file.path;
    console.log("Running audit on:", contractPath);

    const report = await audit(contractPath);
    console.log("Audit complete");

    res.json({
      success: true,
      report
    });

  } catch (err) {
    console.error("AUDIT ERROR:", err.message);
    res.status(500).json({
      error: err.message
    });
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