const { success } = require("../utils/response");

exports.health = async (req, res) => {
  return success(res, "Authentication Module Working");
};