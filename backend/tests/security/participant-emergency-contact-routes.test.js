const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const request = require("supertest");

const allow = (_req, _res, next) => next();
let receivedParams;
const updateEmergencyContact = (req, res) => {
    receivedParams = req.params;
    res.status(204).end();
};

function stub(modulePath, exports) {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// Keep this route test independent of Prisma and Cognito while exercising the
// real route declaration and its path parameters.
stub("../../controllers/participantController", new Proxy({}, { get: () => updateEmergencyContact }));
stub("../../middlewares/requireAuthentication", allow);
stub("../../middlewares/requireAnyRole", { operational: () => allow });
stub("../../middlewares/requirePermission", () => allow);
stub("../../middlewares/security", { rateLimit: () => allow });
stub("../../middlewares/requireRegistrationAssignment", allow);

const participantRoutes = require("../../routes/participantRoutes");

test("participant-scoped emergency-contact updates use the nested participant route", async () => {
    const participantId = "11111111-1111-4111-8111-111111111111";
    const contactId = "22222222-2222-4222-8222-222222222222";
    const app = express();
    app.use(express.json());
    app.use("/api/v1/participants", participantRoutes);

    const nestedResponse = await request(app)
        .patch(`/api/v1/participants/${participantId}/emergency-contacts/${contactId}`)
        .send({});

    assert.equal(nestedResponse.status, 204);
    assert.equal(receivedParams.participantId, participantId);
    assert.equal(receivedParams.contactId, contactId);
});

test("participant routes use event registration assignments instead of global roles", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../routes/participantRoutes.js"), "utf8");
    assert.match(source, /requireRegistrationAssignment/);
    assert.doesNotMatch(source, /requireAnyRole|requirePermission|REGISTRATION_OFFICER/);
});
