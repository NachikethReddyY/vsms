require("dotenv").config();
const prisma = require("./prismaClient");

const [emailArg, fullNameArg, employeeNumberArg, roleArg = "REGISTRATION_OFFICER"] = process.argv.slice(2);
const roles = new Set(["ADMINISTRATOR", "EVENT_MANAGER", "REGISTRATION_OFFICER", "SCREENER", "REVIEWER"]);

function systemRoleFor(role) {
    if (role === "ADMINISTRATOR") return "ADMIN";
    if (role === "EVENT_MANAGER") return "EVENT_MANAGER";
    return "STAFF";
}

async function main() {
    const email = String(emailArg || "").trim().toLowerCase();
    const fullName = String(fullNameArg || "").trim();
    const employeeNumber = String(employeeNumberArg || "").trim();
    const roleName = String(roleArg || "").trim().toUpperCase();
    if (!email || !fullName || !employeeNumber || !roles.has(roleName)) {
        throw new Error(`Usage: npm run provision-staff -- email fullName employeeNumber [${[...roles].join("|")}]`);
    }

    const role = await prisma.role.upsert({
        where: { roleName },
        update: {},
        create: { roleName, description: `${roleName} staff role` },
    });
    const user = await prisma.user.upsert({
        where: { email },
        update: {
            fullName,
            employeeNumber,
            status: "ACTIVE",
            sysRole: systemRoleFor(roleName),
        },
        create: {
            username: email,
            email,
            fullName,
            employeeNumber,
            status: "ACTIVE",
            sysRole: systemRoleFor(roleName),
        },
    });
    await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
    });
    console.log(`Provisioned ${email} as ${roleName}. No password was stored locally.`);
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
