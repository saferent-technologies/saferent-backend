const firebase = require("../config/firebase");
const authRepository = require("../repositories/auth.repository");
const { generateToken } = require("../utils/jwt");

exports.loginWithFirebase = async (idToken, deviceToken) => {
  let decodedToken;

  try {
    decodedToken = await firebase.auth.verifyIdToken(idToken);
  } catch (err) {
    console.error("Firebase Verify Error:", err);
    throw {
      status: 401,
      message: "Invalid Firebase token",
    };
  }

  const {
    uid: firebaseUid,
    phone_number: phoneNumber,
  } = decodedToken;

  if (!firebaseUid || !phoneNumber) {
    throw {
      status: 401,
      message: "Invalid Firebase token payload",
    };
  }

  let user = await authRepository.findUserByFirebaseUid(firebaseUid);

  let isNewUser = false;

  if (!user) {
    user = await authRepository.createUser({
      firebaseUid,
      phoneNumber,
      deviceToken,
    });

    isNewUser = true;
  } else {
    user = await authRepository.updateUserLogin(
      user.id,
      deviceToken
    );
  }

  const token = generateToken({
    id: user.id,
    firebaseUid: user.firebaseUid,
  });

  return {
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
      profileCompleted: user.profileCompleted,
    },
  };
};