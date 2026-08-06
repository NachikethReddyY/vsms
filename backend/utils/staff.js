const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");
const { APPLICATION_ROLES, normalizeApplicationRole, rolesFromCognitoGroups } = require("./roles");

const ALLOWED_ROLES = APPLICATION_ROLES;

function normalizeRole(role) {
    return normalizeApplicationRole(role);
}

async function ensureRole(roleName) {
    return prisma.role.upsert({
        where: { roleName },
        update: {},
        create: {
            roleName,
            description: `${roleName} application role`,
        },
    });
}

function buildPendingEmployeeNumber(email) {
    const suffix = crypto.createHash("sha256").update(email).digest("hex").slice(0, 12);
    return `PENDING-${suffix}`;
}

async function assertRegistrationAssignment(db, eventId, auth) {
    const roles = auth?.roles || [];
    if (roles.includes("ADMINISTRATOR") || !roles.includes("REGISTRATION_OFFICER")) {
        const error = new Error("A registration officer account role is required");
        error.statusCode = 403;
        throw error;
    }
    const now = new Date();
    const assignment = await db.staffAssignment.findFirst({
        where: {
            ...(eventId ? { eventId } : {}),
            userId: auth.userId,
            assignmentRole: "REGISTRATION",
            status: { in: ["ASSIGNED", "CONFIRMED"] },
            shift: {
                ...(eventId ? { eventId } : {}),
                status: "ACTIVE",
                startsAt: { lte: now },
                endsAt: { gt: now },
            },
        },
        select: { id: true },
    });
    if (!assignment) {
        const error = new Error(eventId
            ? "An active registration assignment is required for this event"
            : "An active registration assignment is required");
        error.statusCode = 403;
        throw error;
    }
}

async function assertScreenerAssignment(db, eventId, auth, stationId) {
    const roles = auth?.roles || [];
    if (roles.includes("ADMINISTRATOR") || !roles.includes("SCREENER")) {
        const error = new Error("A screener account role is required");
        error.statusCode = 403;
        throw error;
    }
    const now = new Date();
    const assignment = await db.staffAssignment.findFirst({
        where: {
            ...(eventId ? { eventId } : {}),
            userId: auth.userId,
            assignmentRole: "SCREENER",
            status: { in: ["ASSIGNED", "CONFIRMED"] },
            ...(stationId ? { stationId } : {}),
            shift: {
                ...(eventId ? { eventId } : {}),
                status: "ACTIVE",
                startsAt: { lte: now },
                endsAt: { gt: now },
            },
        },
        select: { id: true },
    });
    if (!assignment) {
        const error = new Error(eventId
            ? "An active screener assignment is required for this event"
            : "An active screener assignment is required");
        error.statusCode = 403;
        throw error;
    }
}

async function assertQrVerifyAccess(db, eventId, auth) {
    const roles = auth?.roles || [];
    if (roles.includes("REGISTRATION_OFFICER") && !roles.includes("ADMINISTRATOR")) {
        await assertRegistrationAssignment(db, eventId, auth);
        return;
    }
    if (roles.includes("SCREENER") && !roles.includes("ADMINISTRATOR")) {
        await assertScreenerAssignment(db, eventId, auth);
        return;
    }
    const error = new Error("A registration officer or screener account role is required");
    error.statusCode = 403;
    throw error;
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
        const error = new Error("No approved local staff profile exists for this Cognito account");
        error.statusCode = 403;
        throw error;
    }

    if (!user) {
        user = await prisma.user.create({
            data: {
                cognitoSub: profile.cognitoSub || null,
                username: normalizedEmail,
                fullName: profile.fullName || "Pending Staff",
                email: normalizedEmail,
                employeeNumber: profile.employeeNumber || buildPendingEmployeeNumber(normalizedEmail),
                department: profile.department || null,
                designation: profile.designation || null,
                status: "INACTIVE",
                sysRole: "STAFF",
            },
        });

        const role = await ensureRole("REGISTRATION_OFFICER");
        await prisma.userRole.create({
            data: {
                userId: user.id,
                roleId: role.id,
            },
        });
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
