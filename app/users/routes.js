var express = require("express");

var { getUsers, createUsers, loginUser } = require("./controller");
var router = express.Router();

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("index", { title: "Express" });
});

/* GET users listing. */
router.post("/create", createUsers);
router.post("/login", loginUser);

module.exports = router;
