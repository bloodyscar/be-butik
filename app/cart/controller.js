var express = require("express");
var router = express.Router();
const db = require("../../config/database");

module.exports = {
  createCart: async function (req, res, next) {
    try {
      const { user_id, product_id, quantity } = req.body;

      // Validate required fields
      if (!user_id || !product_id || !quantity) {
        return res.status(400).json({
          success: false,
          error: "Required fields: user_id, product_id, quantity",
        });
      }

      // Validate quantity is a number
      if (isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          error: "Quantity must be a positive number",
        });
      }

      // Check if product exists
      const [product] = await db.promisePool.execute(
        "SELECT id, name, price, stock FROM products WHERE id = ?",
        [product_id]
      );

      if (product.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      // Check if product has enough stock
      if (product[0].stock < quantity) {
        return res.status(400).json({
          success: false,
          error: `Insufficient stock. Available: ${product[0].stock}, Requested: ${quantity}`,
        });
      }

      // Start transaction
      const connection = await db.promisePool.getConnection();
      await connection.beginTransaction();

      try {
        // Check if user already has a cart
        const [existingCart] = await connection.execute(
          "SELECT id FROM carts WHERE user_id = ?",
          [user_id]
        );

        let cartId;
        if (existingCart.length > 0) {
          // User has existing cart
          cartId = existingCart[0].id;
        } else {
          // Create new cart for user
          const [cartResult] = await connection.execute(
            "INSERT INTO carts (user_id, created_at) VALUES (?, NOW())",
            [user_id]
          );
          cartId = cartResult.insertId;
        }

        // Check if item already exists in cart
        const [existingItem] = await connection.execute(
          "SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ?",
          [cartId, product_id]
        );

        if (existingItem.length > 0) {
          // Update existing item quantity
          const newQuantity =
            parseInt(existingItem[0].quantity) + parseInt(quantity);

          // Check if new quantity exceeds stock
          if (newQuantity > product[0].stock) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
              success: false,
              error: `Total quantity would exceed stock. Current in cart: ${existingItem[0].quantity}, Available: ${product[0].stock}`,
            });
          }

          await connection.execute(
            "UPDATE cart_items SET quantity = ? WHERE id = ?",
            [newQuantity, existingItem[0].id]
          );

          var itemId = existingItem[0].id;
        } else {
          // Add new item to cart
          const [itemResult] = await connection.execute(
            "INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)",
            [cartId, product_id, quantity]
          );
          var itemId = itemResult.insertId;
        }

        // Commit transaction
        await connection.commit();
        connection.release();

        res.status(201).json({
          success: true,
          message:
            existingItem.length > 0
              ? "Cart item updated successfully"
              : "Item added to cart successfully",
          data: {
            cartId: cartId,
            itemId: itemId,
            user_id,
            product_id,
            quantity:
              existingItem.length > 0
                ? parseInt(existingItem[0].quantity) + parseInt(quantity)
                : quantity,
            product_name: product[0].name,
            product_price: product[0].price,
          },
        });
      } catch (error) {
        // Rollback transaction
        await connection.rollback();
        connection.release();
        throw error;
      }
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to add item to cart",
      });
    }
  },

  getAllCarts: async function (req, res, next) {
    try {
      const { user_id } = req.query;

      // Build WHERE clause
      let whereClause = "";
      let queryParams = [];

      if (user_id && !isNaN(user_id)) {
        whereClause = "WHERE c.user_id = ?";
        queryParams.push(parseInt(user_id));
      }

      // Get carts with user information
      const [carts] = await db.promisePool.execute(
        `SELECT 
          c.*,
          u.name as user_name,
          u.email as user_email
        FROM carts c
        LEFT JOIN users u ON c.user_id = u.id
        ${whereClause}
        ORDER BY c.created_at DESC`,
        queryParams
      );

      // Get cart items for each cart
      for (let cart of carts) {
        const [items] = await db.promisePool.execute(
          `SELECT 
            ci.*,
            p.name as product_name,
            p.description as product_description,
            p.price as product_price,
            p.image as product_image,
            p.stock as product_stock,
            (ci.quantity * p.price) as subtotal
          FROM cart_items ci
          LEFT JOIN products p ON ci.product_id = p.id
          WHERE ci.cart_id = ?
          ORDER BY ci.id DESC`,
          [cart.id]
        );

        // Calculate total for this cart
        const total = items.reduce(
          (sum, item) => sum + parseFloat(item.subtotal || 0),
          0
        );

        cart.items = items;
        cart.total_items = items.length;
        cart.total_amount = total;
      }

      res.json({
        success: true,
        data: {
          carts,
          total_carts: carts.length,
        },
      });
    } catch (error) {
      console.error("Database query error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch carts",
      });
    }
  },

  updateCart: async function (req, res, next) {
    try {
      const cartItemId = req.params.id;
      const { quantity } = req.body;

      // Validate cart item ID
      if (!cartItemId || isNaN(cartItemId)) {
        return res.status(400).json({
          success: false,
          error: "Valid cart item ID is required",
        });
      }

      // Validate quantity
      if (!quantity || isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          error: "Quantity must be a positive number",
        });
      }

      // Check if cart item exists and get product info
      const [cartItem] = await db.promisePool.execute(
        `SELECT 
          ci.*,
          p.name as product_name,
          p.price as product_price,
          p.stock as product_stock
        FROM cart_items ci
        LEFT JOIN products p ON ci.product_id = p.id
        WHERE ci.id = ?`,
        [cartItemId]
      );

      if (cartItem.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Cart item not found",
        });
      }

      const item = cartItem[0];

      // Check if requested quantity exceeds stock
      if (quantity > item.product_stock) {
        return res.status(400).json({
          success: false,
          error: `Insufficient stock. Available: ${item.product_stock}, Requested: ${quantity}`,
        });
      }

      // Update cart item quantity
      const [result] = await db.promisePool.execute(
        "UPDATE cart_items SET quantity = ? WHERE id = ?",
        [quantity, cartItemId]
      );

      res.json({
        success: true,
        message: "Cart item updated successfully",
        data: {
          cartItemId: cartItemId,
          product_id: item.product_id,
          product_name: item.product_name,
          old_quantity: item.quantity,
          new_quantity: quantity,
          product_price: item.product_price,
          new_subtotal: quantity * item.product_price,
          affectedRows: result.affectedRows,
        },
      });
    } catch (error) {
      console.error("Database update error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update cart item",
      });
    }
  },

  deleteCart: async function (req, res, next) {
    try {
      const identifier = req.params.id;
      const { type } = req.query; // 'item' or 'cart'

      if (!identifier || isNaN(identifier)) {
        return res.status(400).json({
          success: false,
          error: "Valid ID is required",
        });
      }

      if (type === "item") {
        // Delete specific cart item
        const [existingItem] = await db.promisePool.execute(
          "SELECT id FROM cart_items WHERE id = ?",
          [identifier]
        );

        if (existingItem.length === 0) {
          return res.status(404).json({
            success: false,
            error: "Cart item not found",
          });
        }

        const [result] = await db.promisePool.execute(
          "DELETE FROM cart_items WHERE id = ?",
          [identifier]
        );

        res.json({
          success: true,
          message: "Cart item deleted successfully",
          data: {
            deletedItemId: identifier,
            affectedRows: result.affectedRows,
          },
        });
      } else {
        // Delete entire cart (and all its items due to CASCADE)
        const [existingCart] = await db.promisePool.execute(
          "SELECT id FROM carts WHERE id = ?",
          [identifier]
        );

        if (existingCart.length === 0) {
          return res.status(404).json({
            success: false,
            error: "Cart not found",
          });
        }

        const [result] = await db.promisePool.execute(
          "DELETE FROM carts WHERE id = ?",
          [identifier]
        );

        res.json({
          success: true,
          message: "Cart deleted successfully",
          data: {
            deletedCartId: identifier,
            affectedRows: result.affectedRows,
          },
        });
      }
    } catch (error) {
      console.error("Database delete error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete cart/item",
      });
    }
  },

  clearCart: async function (req, res, next) {
    try {
      const { user_id } = req.body;

      if (!user_id || isNaN(user_id)) {
        return res.status(400).json({
          success: false,
          error: "Valid user_id is required",
        });
      }

      // Find user's cart
      const [cart] = await db.promisePool.execute(
        "SELECT id FROM carts WHERE user_id = ?",
        [user_id]
      );

      if (cart.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Cart not found for this user",
        });
      }

      // Delete all items from cart
      const [result] = await db.promisePool.execute(
        "DELETE FROM cart_items WHERE cart_id = ?",
        [cart[0].id]
      );

      res.json({
        success: true,
        message: "Cart cleared successfully",
        data: {
          cartId: cart[0].id,
          deletedItems: result.affectedRows,
        },
      });
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to clear cart",
      });
    }
  },
};
