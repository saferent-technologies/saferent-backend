const prisma = require("../config/prisma");

const findUserByFirebaseUid = async (firebaseUid) => {
  return prisma.user.findUnique({
    where: { firebaseUid },
  });
};

const findUserByPhoneNumber = async (phoneNumber) => {
  return prisma.user.findUnique({
    where: { phoneNumber },
  });
};

const createUser = async (data) => {
  return prisma.user.create({
    data: {
      ...data,
      role: "TENANT",
      isProfileCompleted: false,
      isActive: true,
      isVerified: true,
      lastLoginAt: new Date(),
    },
  });
};

const updateUser = async (id, data) => {
  return prisma.user.update({
    where: { id },
    data: {
      ...data,
      lastLoginAt: new Date(),
    },
  });
};

const upsertUser = async ({ firebaseUid, phoneNumber, deviceToken }) => {
  return prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({
      where: { firebaseUid },
    });

    let isNewUser = false;

    if (user) {
      // User found by firebaseUid, update last login and device token
      user = await tx.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          deviceToken: deviceToken ?? null,
        },
      });
    } else {
      // User not found by firebaseUid, check by phone number
      user = await tx.user.findUnique({
        where: { phoneNumber },
      });

      if (user) {
        // User found by phone number, update firebaseUid and last login
        user = await tx.user.update({
          where: { id: user.id },
          data: {
            firebaseUid,
            lastLoginAt: new Date(),
            deviceToken: deviceToken ?? null,
          },
        });
      } else {
        // User not found, create new user
        user = await tx.user.create({
          data: {
            firebaseUid,
            phoneNumber,
            deviceToken: deviceToken ?? null,
            role: "TENANT",
            isProfileCompleted: false,
            isActive: true,
            isVerified: true,
            lastLoginAt: new Date(),
          },
        });
        isNewUser = true;
      }
    }

    return { user, isNewUser };
  });
};

module.exports = {
  findUserByFirebaseUid,
  findUserByPhoneNumber,
  createUser,
  updateUser,
  upsertUser,
};