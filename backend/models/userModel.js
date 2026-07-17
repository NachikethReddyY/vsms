const prisma = require("../prisma/prismaClient");

exports.getAll = async () => {
    return await prisma.users.findMany();
};

exports.findByEmail = async (email) => {
    return await prisma.users.findUnique({
        where: {
            email: email
        }
    });
};

exports.create = async (userData) => {
    return await prisma.users.create({
        data: userData
    });
};

exports.findById = async (userId) => {
    return await prisma.users.findUnique({
        where: {
            userId: userId
        }
    });
};

exports.update = async (userId, userData) => {
    return await prisma.users.update({
        where: {
            userId: userId
        },
        data: userData
    });
};

exports.delete = async (userId) => {
    return await prisma.users.delete({
        where: {
            userId: userId
        }
    });
};