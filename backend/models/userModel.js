const prisma = require("../prisma/prismaClient");


// ==========================================
// Get All Users (Staff)
// ==========================================
exports.getAll = async () => {

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
            createdAt: true
        }

    });

};



// ==========================================
// Find User By Email
// ==========================================
exports.findByEmail = async (email) => {

    return await prisma.user.findUnique({

        where: {
            email: email
        }

    });

};



// ==========================================
// Create Staff User
// ==========================================
exports.create = async (userData) => {

    return await prisma.user.create({

        data: {

            fullName: userData.fullName,

            email: userData.email,

            contactNumber: userData.contactNumber,

            employeeNumber: userData.employeeNumber,

            department: userData.department,

            designation: userData.designation,

            status: userData.status || "ACTIVE"

        },

        select: {

            id: true,
            fullName: true,
            email: true,
            employeeNumber: true,
            department: true,
            designation: true,
            status: true

        }

    });

};



// ==========================================
// Find User By ID
// ==========================================
exports.findById = async (userId) => {

    return await prisma.user.findUnique({

        where: {
            id: userId
        },

        select: {

            id: true,
            fullName: true,
            email: true,
            contactNumber: true,
            employeeNumber: true,
            department: true,
            designation: true,
            status: true

        }

    });

};



// ==========================================
// Update User
// ==========================================
exports.update = async (userId, userData) => {

    return await prisma.user.update({

        where: {
            id: userId
        },

        data: userData,

        select: {

            id: true,
            fullName: true,
            email: true,
            department: true,
            designation: true,
            status: true

        }

    });

};



// ==========================================
// Delete User
// ==========================================
exports.delete = async (userId) => {

    return await prisma.user.delete({

        where: {
            id: userId
        }

    });

};