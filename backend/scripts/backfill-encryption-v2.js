const prisma = require("../prisma/prismaClient");
const {
  encrypt,
  decrypt,
  encryptionContext,
  ciphertextKeyId,
  activeEncryptionKeyId,
} = require("../utils/cryptoUtils");

const apply = process.argv.includes("--apply");
const maskedEmail = /^[^@]\*{3}@[^@]+$/;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maskEmail = (value) => `${value.slice(0, 1)}***@${value.split("@")[1]}`;
const context = (id, field) => encryptionContext("NotificationDelivery", id, field);

async function main() {
  const rows = await prisma.notificationDelivery.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      recipient: true,
      recipientCiphertext: true,
      handoffSecretCiphertext: true,
    },
  });
  const activeKeyId = activeEncryptionKeyId();
  const plan = [];

  for (const row of rows) {
    let recipientPlain = null;
    if (row.recipientCiphertext) recipientPlain = decrypt(row.recipientCiphertext, context(row.id, "recipient"));
    else if (email.test(row.recipient) && !maskedEmail.test(row.recipient)) recipientPlain = row.recipient.toLowerCase();
    if (recipientPlain && !email.test(recipientPlain)) throw new Error(`Delivery ${row.id} has an invalid encrypted recipient`);

    const recipientNeedsRotation = recipientPlain && ciphertextKeyId(row.recipientCiphertext) !== activeKeyId;
    const recipientNeedsMasking = recipientPlain && row.recipient !== maskEmail(recipientPlain);
    let handoffPlain = null;
    if (row.handoffSecretCiphertext) handoffPlain = decrypt(row.handoffSecretCiphertext, context(row.id, "handoffSecret"));
    const handoffNeedsRotation = handoffPlain && ciphertextKeyId(row.handoffSecretCiphertext) !== activeKeyId;

    if (!recipientNeedsRotation && !recipientNeedsMasking && !handoffNeedsRotation) continue;
    plan.push({ row, recipientPlain, handoffPlain, recipientNeedsRotation, recipientNeedsMasking, handoffNeedsRotation });
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned: rows.length, updates: plan.length, activeKeyId }));
  if (!apply) return;

  for (const item of plan) {
    const { row } = item;
    const data = {};
    if (item.recipientPlain) {
      data.recipient = maskEmail(item.recipientPlain);
      data.recipientCiphertext = encrypt(item.recipientPlain, context(row.id, "recipient"));
    }
    if (item.handoffPlain) data.handoffSecretCiphertext = encrypt(item.handoffPlain, context(row.id, "handoffSecret"));
    await prisma.$transaction(async (tx) => {
      await tx.notificationDelivery.update({ where: { id: row.id }, data });
      await tx.auditLog.create({ data: {
        action: "ENCRYPTION_BACKFILL_APPLIED",
        resource: "NotificationDelivery",
        entityName: "NotificationDelivery",
        entityId: row.id,
        details: {
          recipientRotated: Boolean(item.recipientNeedsRotation),
          recipientMasked: Boolean(item.recipientNeedsMasking),
          handoffSecretRotated: Boolean(item.handoffNeedsRotation),
          previousRecipientKeyId: ciphertextKeyId(row.recipientCiphertext),
          previousHandoffKeyId: ciphertextKeyId(row.handoffSecretCiphertext),
          activeKeyId,
        },
      } });
    });
  }
  await prisma.$executeRawUnsafe('ALTER TABLE "notification_deliveries" VALIDATE CONSTRAINT "notification_deliveries_recipient_masked_check"');
  console.log(JSON.stringify({ mode: "complete", updated: plan.length, constraintValidated: true, activeKeyId }));
}

main()
  .catch((error) => {
    console.error(`Encryption backfill failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
