const prisma = require("../prisma/prismaClient");

exports.getAll = async () => {
    return prisma.user.findMany({
        select: { userId: true, username: true, email: true, systemRole: true, status: true, createdAt: true },
        take: 100,
        orderBy: { createdAt: "desc" }
    });
};

exports.findByEmail = async (email) => {
    return prisma.user.findUnique({
        where: {
            email: email
        }
    });
};

exports.create = async (userData) => {
    return prisma.user.create({
        data: userData
    });
};

exports.findById = async (userId) => {
    return prisma.user.findUnique({
        where: {
            userId: userId
        }
    });
};

exports.update = async (userId, userData) => {
    return prisma.user.update({
        where: {
            userId: userId
        },
        data: userData
    });
};

exports.delete = async (userId) => {
    return prisma.user.delete({
        where: {
            userId: userId
        }
    });
};
