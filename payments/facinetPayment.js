import { Facinet } from "facinet";

export function getPaymentRequest(network) {
  return {
    amount: process.env.PAYMENT_AMOUNT || "1",
    recipient: process.env.RECEIVING_WALLET,
    network: network,
    description: "Solidity smart contract audit"
  };
}

export async function verifyPayment(paymentData) {
  try {
    if (!paymentData.txHash || !paymentData.success) return false;
    return true;
  } catch (err) {
    return false;
  }
}