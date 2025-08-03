var express = require("express");

var {
  createProduct,
  getAllProduct,
  deleteProduct,
  updateProduct,
  getDashboardStats,
  filterProduct,
  getAllAgeCategories,
  getAllSizeCategories,
} = require("./controller");
const { uploadSingle } = require("../../config/multer");
var router = express.Router();

/* POST create product. */
router.post("/create", uploadSingle, createProduct);

/* GET all products. */
router.get("/", getAllProduct);

/* GET dashboard statistics. */
router.get("/dashboard/stats", getDashboardStats);

/* GET filtered products by size and age categories. */
router.get("/filter", filterProduct);

/* GET all age categories. */
router.get("/age-categories", getAllAgeCategories);

/* GET all size categories. */
router.get("/size-categories", getAllSizeCategories);

/* PUT update product by ID. */
router.put("/:id", uploadSingle, updateProduct);

/* DELETE product by ID. */
router.delete("/:id", deleteProduct);

module.exports = router;
