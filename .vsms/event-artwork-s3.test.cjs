process.env.NODE_ENV = "test";
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/vsms_test";
process.env.EVENT_ARTWORK_BUCKET = "vsms-test-artwork";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  deleteArtwork,
  isStoredArtwork,
  objectKey,
  readArtwork,
  storeArtwork,
} = require("../backend/services/event/eventArtworkStorage");

const dataUrl = `data:image/jpeg;base64,${Buffer.from("small jpeg").toString("base64")}`;

test("event artwork uses a private content-addressed S3 object", async () => {
  const sent = [];
  const client = { send: async (command) => {
    sent.push(command);
    if (command.constructor.name === "GetObjectCommand") {
      return {
        ContentType: "image/jpeg",
        ETag: '"etag-value"',
        Body: { transformToByteArray: async () => Buffer.from("small jpeg") },
      };
    }
    return {};
  } };

  const reference = await storeArtwork(dataUrl, { client });
  assert.equal(isStoredArtwork(reference), true);
  assert.match(objectKey(reference), /^event-artwork\/[a-f0-9]{64}\.jpg$/);
  assert.equal(sent[0].input.Bucket, "vsms-test-artwork");
  assert.equal(sent[0].input.ServerSideEncryption, "AES256");
  assert.equal(sent[0].input.IfNoneMatch, "*");

  const read = await readArtwork(reference, { client });
  assert.equal(read.contents.toString(), "small jpeg");
  assert.equal(read.mimeType, "image/jpeg");

  await deleteArtwork(reference, { client });
  assert.equal(sent.at(-1).constructor.name, "DeleteObjectCommand");
});
