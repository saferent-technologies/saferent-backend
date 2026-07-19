const { validationResult } = require("express-validator");
const authService = require("../services/auth.service");
const { success, error } = require("../utils/response");

const health = async (req, res) => {
  return success(res, "Authentication Module Working");
};

const login = async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: errors.array(),
    });
  }

  const { idToken, deviceToken } = req.body;

  try {
    const result = await authService.loginWithFirebase(idToken, deviceToken);
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    return error(res, err.message, err.status || 500);
  }
};

const completeProfile = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: errors.array(),
    });
  }

  const userId = req.userId;
  const profileData = req.body;

  try {
    const updatedUser = await authService.completeUserProfile(
      userId,
      profileData
    );
    return success(res, "Profile updated successfully", { user: updatedUser });
  } catch (err) {
    return error(res, err.message, err.status);
  }
};

module.exports = {
  health,
  login,
  completeProfile,
};