const prisma = require("../prisma/prismaClient");
const AppError = require("../errors/AppError");

// ==========================================
// Get All Users
// ==========================================
exports.getAllUsers = async () => {
    return await prisma.user.findMany({
        select: {
            id: true,
            fullName: true,
            email: true,
            contactNumber: true,
            employeeNumber: true,
            department: true,
            designation: true,
            status: true,
            createdAt: true,
        },
        take: 100,
        orderBy: { createdAt: "desc" },
    });
};

// ==========================================
// Get User By ID
// ==========================================
exports.getUserById = async (userId) => {
    if (!userId) {
        throw new AppError(400, "USER_ID_REQUIRED", "User ID is required.");
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user) {
        throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    return user;
};

// ==========================================
// Create Staff User
// ==========================================
exports.createUser = async (userData) => {
    const { fullName, email, employeeNumber } = userData;

    if (!fullName || !email || !employeeNumber) {
        throw new AppError(400, "MISSING_FIELDS", "Full name, email, and employee number are required");
    }

    const existingUser = await prisma.user.findUnique({
        where: { email },
    });

    if (existingUser) {
        throw new AppError(409, "EMAIL_EXISTS", "Email already registered");
    }

    return await prisma.user.create({
        data: {
            fullName,
            email,
            employeeNumber,
            contactNumber: userData.contactNumber,
            department: userData.department,
            designation: userData.designation,
            status: userData.status || "ACTIVE",
        },
    });
};

// ==========================================
// Update User
// ==========================================
exports.updateUser = async (userId, userData) => {
    if (!userId) {
        throw new AppError(400, "USER_ID_REQUIRED", "User ID is required.");
    }

    const existingUser = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!existingUser) {
        throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    return await prisma.user.update({
        where: { id: userId },
        data: userData,
        select: {
            id: true,
            fullName: true,
            email: true,
            department: true,
            designation: true,
            status: true,
        },
    });
};

// ==========================================
// Delete User
// ==========================================
exports.deleteUser = async (userId) => {
    if (!userId) {
        throw new AppError(400, "USER_ID_REQUIRED", "User ID is required.");
    }

    const existingUser = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!existingUser) {
        throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    return await prisma.user.delete({
        where: { id: userId },
    });
};