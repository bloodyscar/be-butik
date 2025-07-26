var express = require("express");

var {
  createProduct,
  getAllProduct,
  deleteProduct,
  updateProduct,
} = require("./controller");
const { uploadSingle } = require("../../config/multer");
var router = express.Router();

/* POST create product. */
router.post("/create", uploadSingle, createProduct);

/* GET all products. */
router.get("/", getAllProduct);

/* PUT update product by ID. */
router.put("/:id", uploadSingle, updateProduct);

/* DELETE product by ID. */
router.delete("/:id", deleteProduct);

module.exports = router;
