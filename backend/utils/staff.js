const crypto = require("crypto");
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

function buildPendingEmployeeNumber(email) {
    const suffix = crypto.createHash("sha256").update(email).digest("hex").slice(0, 12);
    return `PENDING-${suffix}`;
}

async function syncLocalUser(profile) {
    const existingUser = await prisma.user.findUnique({
        where: {
            email: profile.email,
        },
    });

    const updateData = {
        status: "ACTIVE",
    };

    if (profile.fullName) {
        updateData.fullName = profile.fullName;
    }
    if (profile.employeeNumber) {
        updateData.employeeNumber = profile.employeeNumber;
    }
    if (profile.department) {
        updateData.department = profile.department;
    }
    if (profile.designation) {
        updateData.designation = profile.designation;
    }

    const user = await prisma.user.upsert({
        where: {
            email: profile.email,
        },
        update: updateData,
        create: {
            fullName: profile.fullName || "Pending Staff Name",
            email: profile.email,
            employeeNumber: profile.employeeNumber || buildPendingEmployeeNumber(profile.email),
            department: profile.department || null,
            designation: profile.designation || null,
            status: "ACTIVE",
        },
    });

    // Confirmation supplies a role. Later token refreshes may not, so preserve
    // the existing Prisma roles instead of silently adding a default role.
    if (profile.role || !existingUser) {
        const role = await ensureRole(normalizeRole(profile.role));

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
    }

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
