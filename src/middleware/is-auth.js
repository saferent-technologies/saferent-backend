const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/env");
const { error } = require("../utils/response");

module.exports = (req, res, next) => {
  try {
    const authHeader = req.get("Authorization");
    if (!authHeader) {
      return error(res, "Not authenticated.", 401);
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return error(res, "Token not found.", 401);
    }

    const decodedToken = jwt.verify(token, JWT_SECRET);

    if (!decodedToken) {
      return error(res, "Not authenticated.", 401);
    }

    // Attach user ID to the request for use in subsequent controllers
    req.userId = decodedToken.id;
    next();
  } catch (err) {
    // Catches errors from jwt.verify (e.g., expired token)
    return error(res, "Not authenticated. " + err.message, 401);
  }
};