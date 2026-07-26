const prisma = require("../prisma/prismaClient");

const ALLOWED_ROLES = [
    "ADMINISTRATOR",
    "EVENT_MANAGER",
    "REGISTRATION_OFFICER",
    "SCREENER",
    "REVIEWER",
];

function normalizeRole(role) {
    if (!role) {
        return "REGISTRATION_OFFICER";
    }

    const normalized = String(role).trim().toUpperCase().replace(/\s+/g, "_");
    return ALLOWED_ROLES.includes(normalized) ? normalized : "REGISTRATION_OFFICER";
}

async function ensureRole(roleName) {
    return prisma.role.upsert({
        where: {
            roleName,
        },
        update: {},
        create: {
            roleName,
            description: `${roleName} provisioned from Cognito sign-up`,
        },
    });
}

async function syncLocalUser(profile) {
    const roleName = normalizeRole(profile.role);
    const fullName = profile.fullName || "Pending Staff Name";
    const employeeNumber = profile.employeeNumber || `PENDING-${profile.email}`;

    const user = await prisma.user.upsert({
        where: {
            email: profile.email,
        },
        update: {
            fullName,
            employeeNumber,
            department: profile.department || null,
            designation: profile.designation || null,
            status: "ACTIVE",
        },
        create: {
            fullName,
            email: profile.email,
            employeeNumber,
            department: profile.department || null,
            designation: profile.designation || null,
            status: "ACTIVE",
        },
    });

    const role = await ensureRole(roleName);

    await prisma.userRole.upsert({
        where: {
            userId_roleId: {
                userId: user.id,
                roleId: role.id,
            },
        },
        update: {},
        create: {
            userId: user.id,
            roleId: role.id,
        },
    });

    return prisma.user.findUnique({
        where: {
            id: user.id,
        },
        include: {
            userRoles: {
                include: {
                    role: true,
                },
            },
        },
    });
}

module.exports = {
    normalizeRole,
    syncLocalUser,
    ALLOWED_ROLES,
};
