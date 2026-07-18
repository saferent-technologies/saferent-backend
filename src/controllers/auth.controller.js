const { validationResult } = require("express-validator");
const authService = require("../services/auth.service");
const { success, error } = require("../utils/response");

exports.health = async (req, res) => {
  return success(res, "Authentication Module Working");
};

exports.login = async (req, res) => {
  console.log("========== LOGIN ==========");
  console.log("Headers:", req.headers);
  console.log("Body:", req.body);

  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    console.log("Validation Errors:", errors.array());

    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: errors.array(),
    });
  }

  const { idToken, deviceToken } = req.body;

  try {
    const result = await authService.loginWithFirebase(
      idToken,
      deviceToken
    );

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("Login Error:", err);

    return res.status(err.status || 500).json({
      success: false,
      message: err.message,
    });
  }
};