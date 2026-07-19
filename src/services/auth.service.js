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
        phoneNumber: user.phoneNumber,
        isProfileCompleted: user.isProfileCompleted,
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
  // Logic for completing user profile
  // This part of the code is not specified in the requirements,
  // so I will leave it as it is.
  const updatedUser = {}; // Placeholder
  return updatedUser;
};


module.exports = {
  loginWithFirebase,
  completeUserProfile,
};