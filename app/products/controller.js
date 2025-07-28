var express = require("express");
var router = express.Router();
const db = require("../../config/database");
const fs = require("fs");
const path = require("path");

module.exports = {
  createProduct: async function (req, res, next) {
    try {
      const {
        name,
        description,
        price,
        stock,
        age_category_id,
        size_category_id,
      } = req.body;

      // Get uploaded file path (multer already processed in routes)
      const imagePath = req.file ? `images/${req.file.filename}` : null;

      // Validate required fields
      if (!name || !price || !stock) {
        return res.status(400).json({
          success: false,
          error: "Required fields: name, price, stock",
        });
      }

      // Validate price and stock are numbers
      if (isNaN(price) || isNaN(stock)) {
        return res.status(400).json({
          success: false,
          error: "Price and stock must be valid numbers",
        });
      }

      // Insert new product
      const [result] = await db.promisePool.execute(
        "INSERT INTO products (name, description, price, stock, image, age_category_id, size_category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
        [
          name,
          description,
          price,
          stock,
          imagePath,
          age_category_id || null,
          size_category_id || null,
        ]
      );

      res.status(201).json({
        success: true,
        message: "Product created successfully",
        data: {
          productId: result.insertId,
          name,
          description,
          price: parseFloat(price),
          stock: parseInt(stock),
          image: imagePath,
          age_category_id,
          size_category_id,
        },
      });
    } catch (error) {
      console.error("Database insert error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create product",
      });
    }
  },

  getAllProduct: async function (req, res, next) {
    try {
      // Get pagination parameters from query
      const page = parseInt(req.query.page) || 1;
      const limit = 4; // Fixed limit of 10 per page
      const offset = (page - 1) * limit;

      // Get total count for pagination info
      const [countResult] = await db.promisePool.execute(
        "SELECT COUNT(*) as total FROM products"
      );
      const totalProducts = countResult[0].total;

      // Get products with pagination
      // Note: Using string interpolation for LIMIT and OFFSET as MySQL doesn't support placeholders for these
      const [products] = await db.promisePool.execute(
        `SELECT p.id,name,description,price,stock,image,created_at, ac.label, sc.label, sc.is_custom, sc.custom_value_cm FROM products p
inner join age_categories ac ON  ac.id=p.age_category_id
inner join size_categories sc ON  sc.id=p.size_category_id ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
      );

      // Calculate pagination metadata
      const totalPages = Math.ceil(totalProducts / limit);

      res.json({
        success: true,
        data: {
          products,
          pagination: {
            current_page: page,
            total_pages: totalPages,
            total_products: totalProducts,
            limit: limit,
            has_next: page < totalPages,
            has_prev: page > 1,
          },
        },
      });
    } catch (error) {
      console.error("Database query error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch products",
      });
    }
  },

  deleteProduct: async function (req, res, next) {
    try {
      const productId = req.params.id;

      // Validate product ID
      if (!productId || isNaN(productId)) {
        return res.status(400).json({
          success: false,
          error: "Valid product ID is required",
        });
      }

      // First, get the product to check if it exists and get image path
      const [products] = await db.promisePool.execute(
        "SELECT id, image FROM products WHERE id = ?",
        [productId]
      );

      if (products.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      const product = products[0];

      // Delete the product from database
      const [result] = await db.promisePool.execute(
        "DELETE FROM products WHERE id = ?",
        [productId]
      );

      // If product had an image, try to delete the file
      if (product.image) {
        const imagePath = path.join("public", product.image);
        fs.unlink(imagePath, (err) => {
          if (err) {
            console.log("Warning: Could not delete image file:", err.message);
          }
        });
      }

      res.json({
        success: true,
        message: "Product deleted successfully",
        data: {
          deletedProductId: productId,
          affectedRows: result.affectedRows,
        },
      });
    } catch (error) {
      console.error("Database delete error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete product",
      });
    }
  },

  updateProduct: async function (req, res, next) {
    try {
      const productId = req.params.id;
      const {
        name,
        description,
        price,
        stock,
        age_category_id,
        size_category_id,
      } = req.body;

      // Validate product ID
      if (!productId || isNaN(productId)) {
        return res.status(400).json({
          success: false,
          error: "Valid product ID is required",
        });
      }

      // Check if product exists and get current data
      const [existingProduct] = await db.promisePool.execute(
        "SELECT * FROM products WHERE id = ?",
        [productId]
      );

      if (existingProduct.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      const currentProduct = existingProduct[0];

      // Handle image upload (if new image is provided)
      let imagePath = currentProduct.image; // Keep existing image by default

      if (req.file) {
        // New image uploaded
        imagePath = `images/${req.file.filename}`;

        // Delete old image file if it exists
        if (currentProduct.image) {
          const oldImagePath = path.join("public", currentProduct.image);
          fs.unlink(oldImagePath, (err) => {
            if (err) {
              console.log(
                "Warning: Could not delete old image file:",
                err.message
              );
            }
          });
        }
      }

      // Prepare update data (only update provided fields)
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

      if (name !== undefined) {
        updateFields.push("name = ?");
        updateValues.push(name);
      }

      if (description !== undefined) {
        updateFields.push("description = ?");
        updateValues.push(description);
      }

      if (price !== undefined) {
        if (isNaN(price)) {
          return res.status(400).json({
            success: false,
            error: "Price must be a valid number",
          });
        }
        updateFields.push("price = ?");
        updateValues.push(parseFloat(price));
      }

      if (stock !== undefined) {
        if (isNaN(stock)) {
          return res.status(400).json({
            success: false,
            error: "Stock must be a valid number",
          });
        }
        updateFields.push("stock = ?");
        updateValues.push(parseInt(stock));
      }

      if (age_category_id !== undefined) {
        updateFields.push("age_category_id = ?");
        updateValues.push(age_category_id || null);
      }

      if (size_category_id !== undefined) {
        updateFields.push("size_category_id = ?");
        updateValues.push(size_category_id || null);
      }

      // Always update image and updated_at
      updateFields.push("image = ?", "updated_at = NOW()");
      updateValues.push(imagePath);

      // Add product ID for WHERE clause
      updateValues.push(productId);

      // Check if there are fields to update
      if (updateFields.length === 2) {
        // Only image and updated_at
        return res.status(400).json({
          success: false,
          error: "At least one field must be provided for update",
        });
      }

      // Execute update query
      const updateQuery = `UPDATE products SET ${updateFields.join(
        ", "
      )} WHERE id = ?`;
      const [result] = await db.promisePool.execute(updateQuery, updateValues);

      // Get updated product data
      const [updatedProduct] = await db.promisePool.execute(
        "SELECT * FROM products WHERE id = ?",
        [productId]
      );

      res.json({
        success: true,
        message: "Product updated successfully",
        data: {
          product: updatedProduct[0],
          affectedRows: result.affectedRows,
        },
      });
    } catch (error) {
      console.error("Database update error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update product",
      });
    }
  },
};
