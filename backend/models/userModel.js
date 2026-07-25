const prisma = require("../prisma/prismaClient");

// ==========================================
// Get All Users
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
      createdAt: true,
    },
    take: 100,
    orderBy: { createdAt: "desc" },
  });
};

// ==========================================
// Find User By Email
// ==========================================
exports.findByEmail = async (email) => {
  return await prisma.user.findUnique({
    where: {
      email: email,
    },
  });
};

// ==========================================
// Find User By ID
// ==========================================
exports.findById = async (userId) => {
  return await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });
};

// ==========================================
// Create User
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
      status: userData.status || "ACTIVE",
    },
  });
};

// ==========================================
// Update User
// ==========================================
exports.update = async (userId, userData) => {
  return await prisma.user.update({
    where: {
      id: userId,
    },
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
exports.delete = async (userId) => {
  return await prisma.user.delete({
    where: {
      id: userId,
    },
  });
};