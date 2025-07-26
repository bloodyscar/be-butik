var express = require("express");

var {
  createCart,
  getAllCarts,
  deleteCart,
  updateCart,
  clearCart,
} = require("./controller");
var router = express.Router();

/* POST add item to cart. */
router.post("/create", createCart);

/* GET all carts. */
router.get("/", getAllCarts);

/* PUT update cart item quantity by ID. */
router.put("/:id", updateCart);

/* DELETE cart item or entire cart by ID. */
router.delete("/:id", deleteCart);

/* POST clear all items from user's cart. */
router.post("/clear", clearCart);

module.exports = router;
