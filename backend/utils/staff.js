const crypto = require("crypto");
const prisma = require("../prisma/prismaClient");
const { rolesFromCognitoGroups } = require("./roles");

const ALLOWED_ROLES = [
    "ADMINISTRATOR",
    "EVENT_MANAGER",
    "REGISTRATION_OFFICER",
    "SCREENER",
    "REVIEWER",
];

function normalizeRole(role) {
    const normalized = String(role || "").trim().toUpperCase().replace(/\s+/g, "_");
    return ALLOWED_ROLES.includes(normalized) ? normalized : null;
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
    ALLOWED_ROLES,
};
