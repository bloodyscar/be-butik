var express = require("express");

var {
  createOrder,
  getAllOrders,
  deleteOrder,
  updateOrder,
} = require("./controller");
const { uploadSingle } = require("../../config/multer");
const { authenticateToken } = require("../../config/jwt");
var router = express.Router();

/* POST create order. */
router.post("/create", authenticateToken, uploadSingle, createOrder);

/* GET all orders. */
router.get("/", authenticateToken, getAllOrders);

/* PUT update order by ID. */
router.put("/:id", authenticateToken, uploadSingle, updateOrder);

/* DELETE order by ID. */
router.delete("/:id", authenticateToken, deleteOrder);

module.exports = router;
