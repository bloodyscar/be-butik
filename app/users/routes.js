var express = require("express");

var { getAllUsers, editUsers, deleteUsers, createUsers, loginUser } = require("./controller");
var router = express.Router();

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("index", { title: "Express" });
});

/* GET users listing. */
router.get("/all", getAllUsers);
router.post("/create", createUsers);
router.post("/login", loginUser);
router.put("/edit/:id", editUsers);
router.delete("/delete/:id", deleteUsers);

module.exports = router;
