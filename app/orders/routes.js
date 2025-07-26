var express = require("express");

var {
  createOrder,
  getAllOrders,
  deleteOrder,
  updateOrder,
} = require("./controller");
const { uploadSingle } = require("../../config/multer");
var router = express.Router();

/* POST create order. */
router.post("/create", uploadSingle, createOrder);

/* GET all orders. */
router.get("/", getAllOrders);

/* PUT update order by ID. */
router.put("/:id", uploadSingle, updateOrder);

/* DELETE order by ID. */
router.delete("/:id", deleteOrder);

module.exports = router;
