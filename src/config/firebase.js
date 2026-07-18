const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

try {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccountBase64) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable not set.");
  }

  const serviceAccount = JSON.parse(
    Buffer.from(serviceAccountBase64, "base64").toString("utf8")
  );

  initializeApp({
    credential: cert(serviceAccount),
  });

  console.log("🔥 Firebase Admin SDK initialized successfully.");
} catch (error) {
  console.error("🔥 Firebase Admin SDK initialization error:", error);
}

module.exports = {
  auth: getAuth(),
};