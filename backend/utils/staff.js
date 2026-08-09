const prisma = require("../prisma/prismaClient");
const { APPLICATION_ROLES, normalizeApplicationRole, rolesFromCognitoGroups } = require("./roles");
const eventAuthorization = require("../services/event/eventAuthorizationService");
const env = require("../config/env");
const { enqueueAccountLifecycle } = require("../services/account/accountLifecycleNotificationService");

const ALLOWED_ROLES = APPLICATION_ROLES;

function normalizeRole(role) {
    return normalizeApplicationRole(role);
}

async function assertRegistrationAssignment(db, eventId, auth) {
    return eventAuthorization.requireEventRoleAndDuty(eventId, auth?.user || auth, "REGISTRATION", { db });
}

async function assertScreenerAssignment(db, eventId, auth, stationId) {
    return eventAuthorization.requireEventRoleAndDuty(eventId, auth?.user || auth, "SCREENER", { db, stationId });
}

async function assertQrVerifyAccess(db, eventId, auth) {
    const user = auth?.user || auth;
    const membership = await eventAuthorization.requireEventRoles(eventId, user, ["REGISTRATION", "SCREENER"], { db });
    if (membership.roles.has("REGISTRATION")) {
        try { return await eventAuthorization.requireCurrentDuty(eventId, user, "REGISTRATION", { db }); } catch (_error) {}
    }
    return eventAuthorization.requireCurrentDuty(eventId, user, "SCREENER", { db });
}

async function syncLocalUser(profile, { allowCreate = false } = {}) {
    const normalizedEmail = String(profile.email || "").trim().toLowerCase();
    const identityMatches = [];
    if (profile.cognitoSub) identityMatches.push({ cognitoSub: profile.cognitoSub });
    if (normalizedEmail) identityMatches.push({ email: normalizedEmail });

    let user = identityMatches.length
        ? await prisma.user.findFirst({ where: { OR: identityMatches } })
        : null;

    if (!user && !allowCreate) {
        const error = new Error("No local staff profile exists for this Cognito account");
        error.statusCode = 403;
        throw error;
    }

    if (!user) {
        const data = {
                cognitoSub: profile.cognitoSub || null,
                username: normalizedEmail,
                fullName: profile.fullName || "Pending Staff",
                email: normalizedEmail,
                employeeNumber: profile.employeeNumber || null,
                department: profile.department || null,
                designation: profile.designation || null,
                status: "INACTIVE",
                sysRole: "STAFF",
                approvalState: "PENDING",
                accessState: "ENABLED",
        };
        if (env.lifecycleEmailEnabled) {
            user = await prisma.$transaction(async (tx) => {
                const created = await tx.user.create({ data });
                await enqueueAccountLifecycle({ type: "SIGNUP_RECEIVED", account: created, idempotencyKey: `SIGNUP_RECEIVED:${created.id}`, db: tx });
                return created;
            });
        } else {
            user = await prisma.user.create({ data });
        }
    } else {
        const update = {};
        if (profile.cognitoSub && !user.cognitoSub) update.cognitoSub = profile.cognitoSub;
        if (profile.fullName) update.fullName = profile.fullName;
        if (profile.employeeNumber) update.employeeNumber = profile.employeeNumber;
        if (profile.department !== undefined) update.department = profile.department || null;
        if (profile.designation !== undefined) update.designation = profile.designation || null;

        if (Object.keys(update).length > 0) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: update,
            });
        }
    }

    return prisma.user.findUnique({
        where: { id: user.id },
        include: {
            userRoles: {
                include: { role: true },
            },
        },
    });
}

module.exports = {
    normalizeRole,
    rolesFromCognitoGroups,
    syncLocalUser,
    assertRegistrationAssignment,
    assertScreenerAssignment,
    assertQrVerifyAccess,
    ALLOWED_ROLES,
};
