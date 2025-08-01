var express = require("express");
var router = express.Router();
const db = require("../../config/database");
const fs = require("fs");
const path = require("path");

module.exports = {
  createOrder: async function (req, res, next) {
    try {
      const {
        user_id,
        shipping_method,
        shipping_address,
        shipping_cost,
        items, // Array of {product_id, quantity, unit_price}
      } = req.body;

      // Validate required fields
      // if (
      //   !user_id ||
      //   !shipping_method ||
      //   !shipping_address ||
      //   !items ||
      //   !Array.isArray(items) ||
      //   items.length === 0
      // ) {
      //   return res.status(400).json({
      //     success: false,
      //     error:
      //       "Required fields: user_id, shipping_method, shipping_address, items (array)",
      //   });
      // }

      // Validate shipping_cost
      if (shipping_cost && isNaN(shipping_cost)) {
        return res.status(400).json({
          success: false,
          error: "Shipping cost must be a valid number",
        });
      }

      // Handle transfer proof upload (if uploaded)
      const transferProofPath = req.file ? `images/${req.file.filename}` : null;

      // Calculate total price from items
      let totalPrice = 0;

      // parse json items
      const parseItems = JSON.parse(items);

      for (const item of parseItems) {
        if (!item.product_id || !item.quantity || !item.unit_price) {
          return res.status(400).json({
            success: false,
            error: "Each item must have product_id, quantity, and unit_price",
          });
        }
        if (isNaN(item.quantity) || isNaN(item.unit_price)) {
          return res.status(400).json({
            success: false,
            error: "Item quantity and unit_price must be valid numbers",
          });
        }
        totalPrice += parseFloat(item.unit_price) * parseInt(item.quantity);
      }

      // Add shipping cost to total
      if (shipping_cost) {
        totalPrice += parseFloat(shipping_cost);
      }

      // Start transaction
      const connection = await db.promisePool.getConnection();
      await connection.beginTransaction();

      try {
        // Insert order
        const [orderResult] = await connection.execute(
          "INSERT INTO orders (user_id, total_price, shipping_method, shipping_address, shipping_cost, transfer_proof, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())",
          [
            user_id,
            totalPrice,
            shipping_method,
            shipping_address,
            shipping_cost || 0,
            transferProofPath,
          ]
        );

        const orderId = orderResult.insertId;

        // Insert order items
        for (const item of parseItems) {
          await connection.execute(
            "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
            [orderId, item.product_id, item.quantity, item.unit_price]
          );
        }

        // Commit transaction
        await connection.commit();
        connection.release();

        res.status(201).json({
          success: true,
          message: "Order created successfully",
          data: {
            orderId: orderId,
            user_id,
            total_price: totalPrice,
            shipping_method,
            shipping_address,
            shipping_cost: shipping_cost || 0,
            transfer_proof: transferProofPath,
            status: "pending",
            items_count: parseItems.length,
          },
        });
      } catch (error) {
        // Rollback transaction
        await connection.rollback();
        connection.release();
        throw error;
      }
    } catch (error) {
      console.error("Database insert error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create order",
      });
    }
  },

  getAllOrders: async function (req, res, next) {
    try {
      // Get pagination parameters
      const page = parseInt(req.query.page) || 1;
      const limit = 10;
      const offset = (page - 1) * limit;

      // Get filters
      const { user_id, status } = req.query;

      // Build WHERE clause
      let whereConditions = [];
      let queryParams = [];

      // Check user role - if not admin, only show their own orders
      if (req.user.role !== 'admin') {
        whereConditions.push("o.user_id = ?");
        queryParams.push(req.user.id);
      } else {
        // Admin can filter by user_id if specified
        if (user_id && !isNaN(user_id)) {
          whereConditions.push("o.user_id = ?");
          queryParams.push(parseInt(user_id));
        }
      }

      if (
        status &&
        ["pending", "proses", "dikirim", "selesai"].includes(status)
      ) {
        whereConditions.push("o.status = ?");
        queryParams.push(status);
      }

      const whereClause =
        whereConditions.length > 0
          ? `WHERE ${whereConditions.join(" AND ")}`
          : "";

      // Get total count
      const [countResult] = await db.promisePool.execute(
        `SELECT COUNT(*) as total FROM orders o ${whereClause}`,
        queryParams
      );
      const totalOrders = countResult[0].total;

      // Get orders with user information
      const [orders] = await db.promisePool.execute(
        `SELECT 
          o.*,
          u.name as user_name,
          u.email as user_email
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        ${whereClause}
        ORDER BY o.created_at DESC 
        LIMIT ${limit} OFFSET ${offset}`,
        queryParams
      );

      // Get order items for each order
      for (let order of orders) {
        const [items] = await db.promisePool.execute(
          `SELECT 
            oi.*,
            p.name as product_name,
            p.image as product_image
          FROM order_items oi
          LEFT JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = ?`,
          [order.id]
        );
        order.items = items;
      }

      const totalPages = Math.ceil(totalOrders / limit);

      res.json({
        success: true,
        data: {
          orders,
          pagination: {
            current_page: page,
            total_pages: totalPages,
            total_orders: totalOrders,
            limit: limit,
            has_next: page < totalPages,
            has_prev: page > 1,
          },
          user_role: req.user.role, // Include user role in response for frontend reference
        },
      });
    } catch (error) {
      console.error("Database query error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch orders",
      });
    }
  },

  updateOrder: async function (req, res, next) {
    try {
      const orderId = req.params.id;
      const { status, shipping_method, shipping_address, shipping_cost } =
        req.body;

      // Validate order ID
      if (!orderId || isNaN(orderId)) {
        return res.status(400).json({
          success: false,
          error: "Valid order ID is required",
        });
      }

      // Check if order exists
      const [existingOrder] = await db.promisePool.execute(
        "SELECT * FROM orders WHERE id = ?",
        [orderId]
      );

      if (existingOrder.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      const currentOrder = existingOrder[0];

      // Handle transfer proof upload
      let transferProofPath = currentOrder.transfer_proof;
      
      if (req.file) {
        transferProofPath = `images/${req.file.filename}`;

        // Delete old transfer proof if exists
        if (currentOrder.transfer_proof) {
          const oldProofPath = path.join("public", currentOrder.transfer_proof);
          fs.unlink(oldProofPath, (err) => {
            if (err) {
              console.log(
                "Warning: Could not delete old transfer proof:",
                err.message
              );
            }
          });
        }

        // If transfer proof is uploaded and no previous transfer proof exists, decrease stock
        if (!currentOrder.transfer_proof) {
          try {
            // Get order items for this order
            const [orderItems] = await db.promisePool.execute(
              "SELECT product_id, quantity FROM order_items WHERE order_id = ?",
              [orderId]
            );

            // Start transaction for stock updates
            const connection = await db.promisePool.getConnection();
            await connection.beginTransaction();

            try {
              // Update stock for each product in the order
              for (const item of orderItems) {
                // Check current stock first
                const [productStock] = await connection.execute(
                  "SELECT stock FROM products WHERE id = ?",
                  [item.product_id]
                );

                if (productStock.length === 0) {
                  throw new Error(`Product with ID ${item.product_id} not found`);
                }

                const currentStock = productStock[0].stock;
                const requestedQuantity = item.quantity;

                // Check if there's enough stock
                if (currentStock < requestedQuantity) {
                  throw new Error(
                    `Insufficient stock for product ID ${item.product_id}. Available: ${currentStock}, Required: ${requestedQuantity}`
                  );
                }

                // Decrease stock
                const [stockUpdateResult] = await connection.execute(
                  "UPDATE products SET stock = stock - ? WHERE id = ?",
                  [requestedQuantity, item.product_id]
                );

                console.log(
                  `Updated stock for product ${item.product_id}: decreased by ${requestedQuantity}`
                );
              }

              // Commit stock updates
              await connection.commit();
              connection.release();

              console.log("Stock updates completed successfully due to transfer proof upload");
            } catch (stockError) {
              // Rollback stock updates on error
              await connection.rollback();
              connection.release();
              throw stockError;
            }
          } catch (stockError) {
            console.error("Stock update error:", stockError);
            return res.status(400).json({
              success: false,
              error: `Failed to update stock: ${stockError.message}`,
            });
          }
        }
      }

      // Prepare update data
      const updateFields = [];
      const updateValues = [];

      if (status !== undefined) {
        if (!["belum bayar", "dikirim", "selesai", "dibatalkan"].includes(status)) {
          return res.status(400).json({
            success: false,
            error:
              "Status must be 'belum bayar', 'dikirim', 'selesai', or 'dibatalkan'",
          });
        }

        updateFields.push("status = ?");
        updateValues.push(status);
      }

      if (shipping_method !== undefined) {
        updateFields.push("shipping_method = ?");
        updateValues.push(shipping_method);
      }

      if (shipping_address !== undefined) {
        updateFields.push("shipping_address = ?");
        updateValues.push(shipping_address);
      }

      if (shipping_cost !== undefined) {
        if (isNaN(shipping_cost)) {
          return res.status(400).json({
            success: false,
            error: "Shipping cost must be a valid number",
          });
        }
        updateFields.push("shipping_cost = ?");
        updateValues.push(parseFloat(shipping_cost));
      }

      // Always update transfer_proof and updated_at
      updateFields.push("transfer_proof = ?", "updated_at = NOW()");
      updateValues.push(transferProofPath);
      updateValues.push(orderId);

      if (updateFields.length === 2) {
        // Only transfer_proof and updated_at
        return res.status(400).json({
          success: false,
          error: "At least one field must be provided for update",
        });
      }

      // Execute update
      const updateQuery = `UPDATE orders SET ${updateFields.join(
        ", "
      )} WHERE id = ?`;
      const [result] = await db.promisePool.execute(updateQuery, updateValues);

      // Get updated order with items
      const [updatedOrder] = await db.promisePool.execute(
        `SELECT 
          o.*,
          u.name as user_name,
          u.email as user_email
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id = ?`,
        [orderId]
      );

      res.json({
        success: true,
        message: "Order updated successfully",
        data: {
          order: updatedOrder[0],
          affectedRows: result.affectedRows,
        },
      });
    } catch (error) {
      console.error("Database update error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update order",
      });
    }
  },

  updateTransferProof: async function (req, res, next) {
    try {
      const orderId = req.params.id;

      // Validate order ID
      if (!orderId || isNaN(orderId)) {
        return res.status(400).json({
          success: false,
          error: "Valid order ID is required",
        });
      }

      // Check if order exists
      const [existingOrder] = await db.promisePool.execute(
        "SELECT * FROM orders WHERE id = ?",
        [orderId]
      );

      if (existingOrder.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      const currentOrder = existingOrder[0];

      // Validate that a file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "Transfer proof image is required",
        });
      }

      // Handle transfer proof upload
      const transferProofPath = `images/${req.file.filename}`;

      // Delete old transfer proof if exists
      if (currentOrder.transfer_proof) {
        const oldProofPath = path.join("public", currentOrder.transfer_proof);
        fs.unlink(oldProofPath, (err) => {
          if (err) {
            console.log(
              "Warning: Could not delete old transfer proof:",
              err.message
            );
          }
        });
      }

      // Update only transfer_proof and updated_at
      const [result] = await db.promisePool.execute(
        "UPDATE orders SET transfer_proof = ?, updated_at = NOW() WHERE id = ?",
        [transferProofPath, orderId]
      );

      // Get updated order with items
      const [updatedOrder] = await db.promisePool.execute(
        `SELECT 
          o.*,
          u.name as user_name,
          u.email as user_email
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id = ?`,
        [orderId]
      );

      res.json({
        success: true,
        message: "Transfer proof updated successfully",
        data: {
          order: updatedOrder[0],
          transfer_proof: transferProofPath,
          affectedRows: result.affectedRows,
        },
      });
    } catch (error) {
      console.error("Database update error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update transfer proof",
      });
    }
  },

  filterByStatus: async function (req, res, next) {
    try {
      // Get pagination parameters
      const page = parseInt(req.query.page) || 1;
      const limit = 10;
      const offset = (page - 1) * limit;

      // Get filter parameters
      const { status, user_id } = req.query;

      // Validate status parameter
      const validStatuses = ["semua", "belum bayar", "dikirim", "selesai", "dibatalkan"];
      if (status && !validStatuses.includes(status.toLowerCase())) {
        return res.status(400).json({
          success: false,
          error: "Invalid status. Valid values: semua, belum bayar, dikirim, selesai, dibatalkan",
        });
      }

      // Build WHERE clause
      let whereConditions = [];
      let queryParams = [];

      // Check user role - if not admin, only show their own orders
      if (req.user.role !== 'admin') {
        whereConditions.push("o.user_id = ?");
        queryParams.push(req.user.id);
      } else {
        // Admin can filter by user_id if specified
        if (user_id && !isNaN(user_id)) {
          whereConditions.push("o.user_id = ?");
          queryParams.push(parseInt(user_id));
        }
      }

      // Add status filter (if not "semua")
      if (status && status.toLowerCase() !== "semua") {
        whereConditions.push("o.status = ?");
        queryParams.push(status.toLowerCase());
      }

      const whereClause =
        whereConditions.length > 0
          ? `WHERE ${whereConditions.join(" AND ")}`
          : "";

      // Get total count for pagination
      const [countResult] = await db.promisePool.execute(
        `SELECT COUNT(*) as total FROM orders o ${whereClause}`,
        queryParams
      );
      const totalOrders = countResult[0].total;

      // Get orders with user information
      const [orders] = await db.promisePool.execute(
        `SELECT 
          o.*,
          u.name as user_name,
          u.email as user_email
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        ${whereClause}
        ORDER BY o.created_at DESC 
        LIMIT ${limit} OFFSET ${offset}`,
        queryParams
      );

      // Get order items for each order
      for (let order of orders) {
        const [items] = await db.promisePool.execute(
          `SELECT 
            oi.*,
            p.name as product_name,
            p.image as product_image
          FROM order_items oi
          LEFT JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = ?`,
          [order.id]
        );
        order.items = items;
      }

      // Get status summary counts for additional information
      let statusSummaryQuery;
      let statusSummaryParams = [];

      if (req.user.role !== 'admin') {
        // Regular user: only their orders
        statusSummaryQuery = "SELECT status, COUNT(*) as count FROM orders WHERE user_id = ? GROUP BY status";
        statusSummaryParams = [req.user.id];
      } else if (user_id && !isNaN(user_id)) {
        // Admin filtering by specific user
        statusSummaryQuery = "SELECT status, COUNT(*) as count FROM orders WHERE user_id = ? GROUP BY status";
        statusSummaryParams = [parseInt(user_id)];
      } else {
        // Admin viewing all orders
        statusSummaryQuery = "SELECT status, COUNT(*) as count FROM orders GROUP BY status";
        statusSummaryParams = [];
      }

      const [statusSummary] = await db.promisePool.execute(statusSummaryQuery, statusSummaryParams);

      // Calculate total pages
      const totalPages = Math.ceil(totalOrders / limit);

      res.json({
        success: true,
        data: {
          orders,
          pagination: {
            current_page: page,
            total_pages: totalPages,
            total_orders: totalOrders,
            limit: limit,
            has_next: page < totalPages,
            has_prev: page > 1,
          },
          filter: {
            status: status || "semua",
            applied_filter: status && status.toLowerCase() !== "semua" ? status : null,
          },
          status_summary: statusSummary,
          user_role: req.user.role,
        },
      });
    } catch (error) {
      console.error("Database query error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to filter orders by status",
      });
    }
  },

  deleteOrder: async function (req, res, next) {
    try {
      const orderId = req.params.id;

      // Validate order ID
      if (!orderId || isNaN(orderId)) {
        return res.status(400).json({
          success: false,
          error: "Valid order ID is required",
        });
      }

      // Check if order exists and get transfer proof path
      const [existingOrder] = await db.promisePool.execute(
        "SELECT id, transfer_proof FROM orders WHERE id = ?",
        [orderId]
      );

      if (existingOrder.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      const order = existingOrder[0];

      // Start transaction
      const connection = await db.promisePool.getConnection();
      await connection.beginTransaction();

      try {
        // Delete order items first (foreign key constraint)
        await connection.execute("DELETE FROM order_items WHERE order_id = ?", [
          orderId,
        ]);

        // Delete order
        const [result] = await connection.execute(
          "DELETE FROM orders WHERE id = ?",
          [orderId]
        );

        // Commit transaction
        await connection.commit();
        connection.release();

        // Delete transfer proof file if exists
        if (order.transfer_proof) {
          const proofPath = path.join("public", order.transfer_proof);
          fs.unlink(proofPath, (err) => {
            if (err) {
              console.log(
                "Warning: Could not delete transfer proof file:",
                err.message
              );
            }
          });
        }

        res.json({
          success: true,
          message: "Order deleted successfully",
          data: {
            deletedOrderId: orderId,
            affectedRows: result.affectedRows,
          },
        });
      } catch (error) {
        // Rollback transaction
        await connection.rollback();
        connection.release();
        throw error;
      }
    } catch (error) {
      console.error("Database delete error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete order",
      });
    }
  },
};
