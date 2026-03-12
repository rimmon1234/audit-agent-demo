export function build402Response(paymentRequest) {
  return Buffer.from(JSON.stringify(paymentRequest)).toString("base64");
}