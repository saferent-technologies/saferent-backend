const express = require("express");
const { body } = require("express-validator");

const router = express.Router();

const authController = require("../controllers/auth.controller");

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

module.exports = router;