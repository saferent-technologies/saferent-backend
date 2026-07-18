const prisma = require("../config/prisma");

exports.findUserByFirebaseUid = async (firebaseUid) => {
  return prisma.user.findUnique({
    where: { firebaseUid },
  });
};

exports.createUser = async ({
  firebaseUid,
  phoneNumber,
  deviceToken,
}) => {
  return prisma.user.create({
    data: {
      firebaseUid,
      phoneNumber,
      deviceToken: deviceToken ?? null,

      role: "TENANT", // Default role

      isProfileCompleted: false,
      isActive: true,
      isVerified: true,
    },
  });
};

exports.updateUserLogin = async (id, deviceToken) => {
  const data = {
    lastLoginAt: new Date(),
  };

  if (deviceToken) {
    data.deviceToken = deviceToken;
  }

  return prisma.user.update({ where: { id }, data });
};