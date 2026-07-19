const authRepository = require("../repositories/auth.repository");
const { auth } = require("../config/firebase");
const { generateToken } = require("../utils/jwt");

const loginWithFirebase = async (idToken, deviceToken) => {
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    const { uid: firebaseUid, phone_number: phoneNumber } = decodedToken;

    if (!phoneNumber) {
      throw new Error("Phone number not available in Firebase token.");
    }

    const { user, isNewUser } = await authRepository.upsertUser({
      firebaseUid,
      phoneNumber,
      deviceToken,
    });

    const token = generateToken({
      id: user.id,
      role: user.role,
    });

    return {
      message: isNewUser
        ? "User created successfully"
        : "User logged in successfully",
      token,
      isNewUser,
      user: {
        id: user.id,
        firebaseUid: user.firebaseUid,
        phoneNumber: user.phoneNumber,
        fullName: user.fullName,
        role: user.role,
        email: user.email,
        gender: user.gender,
        address: user.address,
        latitude: user.latitude,
        longitude: user.longitude,
        profileCompleted: user.isProfileCompleted,
      },
    };
  } catch (error) {
    console.error("Error in loginWithFirebase:", error);
    if (error.code === "auth/id-token-expired") {
      throw { status: 401, message: "Firebase ID token has expired." };
    }
    if (error.code === "auth/argument-error") {
      throw { status: 401, message: "Invalid Firebase ID token." };
    }
    throw { status: 500, message: error.message || "Internal server error" };
  }
};

const completeUserProfile = async (userId, profileData) => {
  const dataToUpdate = {
    ...profileData,
    isProfileCompleted: true,
  };

  if (profileData.role) {
    dataToUpdate.role = profileData.role.toUpperCase();
  }

  const user = await authRepository.updateUser(userId, dataToUpdate);

  return {
    id: user.id,
    firebaseUid: user.firebaseUid,
    phoneNumber: user.phoneNumber,
    fullName: user.fullName,
    role: user.role,
    email: user.email,
    gender: user.gender,
    address: user.address,
    latitude: user.latitude,
    longitude: user.longitude,
    profileCompleted: user.isProfileCompleted,
  };
};


module.exports = {
  loginWithFirebase,
  completeUserProfile,
};