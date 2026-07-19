const express = require("express");
const { body } = require("express-validator");

const router = express.Router();

const authController = require("../controllers/auth.controller");
const isAuth = require("../middleware/is-auth");

router.get("/health", authController.health);

router.post(
  "/login",
  [
    body("idToken")
      .exists()
      .withMessage("idToken is required")
      .bail()
      .notEmpty()
      .withMessage("idToken cannot be empty"),
  ],
  authController.login
);

router.post(
  "/complete-profile",
  isAuth,
  [
    body("fullName")
      .trim()
      .notEmpty()
      .withMessage("Full name is required."),
    body("role")
      .isIn(["Landlord", "Tenant"])
      .withMessage("Role must be either Landlord or Tenant."),
    body("email")
      .optional({ checkFalsy: true })
      .isEmail()
      .withMessage("Please enter a valid email address."),
  ],
  authController.completeProfile
);

module.exports = router;