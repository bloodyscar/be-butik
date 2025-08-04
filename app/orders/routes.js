var express = require("express");

var {
  createOrder,
  getAllOrders,
  deleteOrder,
  updateOrder,
  updateTransferProof,
  filterByStatus,
  getSalesReport,
} = require("./controller");
const { uploadSingle } = require("../../config/multer");
const { authenticateToken } = require("../../config/jwt");
var router = express.Router();

/* POST create order. */
router.post("/create", authenticateToken, uploadSingle, createOrder);

/* GET all orders. */
router.get("/", authenticateToken, getAllOrders);

/* GET orders filtered by status. */
router.get("/filter", authenticateToken, filterByStatus);

/* GET sales reports (daily, weekly, monthly). */
router.get("/reports/sales", authenticateToken, getSalesReport);

/* PUT update order by ID. */
router.put("/:id", authenticateToken, uploadSingle, updateOrder);

/* PUT update transfer proof only by ID. */
router.put("/:id/transfer-proof", authenticateToken, uploadSingle, updateTransferProof);

/* DELETE order by ID. */
router.delete("/:id", authenticateToken, deleteOrder);

module.exports = router;
