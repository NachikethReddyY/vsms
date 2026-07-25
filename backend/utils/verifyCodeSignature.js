const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function verifyApplicationIntegrity() {
  // Skip verification in local development mode
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  try {
    const codePath = path.join(__dirname, '../../dist/server.js');
    const sigPath = path.join(__dirname, '../../dist/server.js.sig');
    const pubKeyPath = path.join(__dirname, '../../public.pem');

    if (!fs.existsSync(sigPath) || !fs.existsSync(pubKeyPath)) {
      throw new Error("Missing signature or public verification key.");
    }

    const codeBuffer = fs.readFileSync(codePath);
    const signature = fs.readFileSync(sigPath);
    const publicKey = fs.readFileSync(pubKeyPath, 'utf8');

    const verifier = crypto.createVerify('SHA256');
    verifier.update(codeBuffer);
    verifier.end();

    const isAuthorized = verifier.verify(publicKey, signature);

    if (!isAuthorized) {
      console.error("SECURITY ALERT: Code signature verification failed! Code has been tampered with.");
      process.exit(1); // Kill the application immediately
    }

    console.log("Code signature verified successfully. Application starting...");
  } catch (error) {
    console.error("Integrity check error:", error.message);
    process.exit(1);
  }
}

module.exports = { verifyApplicationIntegrity };