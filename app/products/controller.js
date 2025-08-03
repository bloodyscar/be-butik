var express = require("express");
var router = express.Router();
const db = require("../../config/database");
const fs = require("fs");
const path = require("path");

module.exports = {
  createProduct: async function (req, res, next) {
    try {
      var {
        name,
        description,
        price,
        stock,
        age_category_id,
        size_category_id,
        size
      } = req.body;

      // Get uploaded file path (multer already processed in routes)
      const imagePath = req.file ? `images/${req.file.filename}` : null;

      if(size_category_id == 0) {
        // tambahkan size ke table size_categories
        // Example: Insert new size into size_categories

        // cek apakah size sudah ada di size_categories pada kolom custom_value_cm
        const [existingSize] = await db.promisePool.execute(
          "SELECT id FROM size_categories WHERE custom_value_cm = ?",
          [size]
        );

        if (existingSize.length > 0) {
          // Size already exists, use its ID
          size_category_id = existingSize[0].id;
        } else {
          // Size does not exist, create a new one
          const [result] = await db.promisePool.execute(
            "INSERT INTO size_categories (label, is_custom, custom_value_cm) VALUES (?, ?, ?)",
            [`Custom ${size} cm`, true, size]
          );

        console.log("New size category created with ID:", result.insertId);
        size_category_id = result.insertId; // Update to new size category ID
      }
    }

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
          age_category_id,
          size_category_id,
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
        `SELECT p.id,name,description,price,stock,image,created_at, ac.label as age_range, sc.label as size, sc.is_custom, sc.custom_value_cm FROM products p
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

      // Start transaction to ensure data consistency
      const connection = await db.promisePool.getConnection();
      await connection.beginTransaction();

      try {
        // Delete related records first to avoid foreign key constraint issues
        
        // 1. Delete from order_items table
        const [orderItemsResult] = await connection.execute(
          "DELETE FROM order_items WHERE product_id = ?",
          [productId]
        );
        // 3. Add any other tables that reference this product
        // Example: DELETE FROM wishlist WHERE product_id = ?
        // Example: DELETE FROM product_reviews WHERE product_id = ?

        // Finally, delete the product itself
        const [result] = await connection.execute(
          "DELETE FROM products WHERE id = ?",
          [productId]
        );

        // Commit the transaction
        await connection.commit();
        connection.release();

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
          message: "Product and all related records deleted successfully",
          data: {
            deletedProductId: productId,
            affectedRows: result.affectedRows,
            deletedOrderItems: orderItemsResult.affectedRows,
          },
        });

      } catch (error) {
        // Rollback transaction on error
        await connection.rollback();
        connection.release();
        throw error;
      }

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
      var {
        name,
        description,
        price,
        stock,
        age_category_id,
        size_category_id,
        size
      } = req.body;

      // Validate product ID
      if (!productId || isNaN(productId)) {
        return res.status(400).json({
          success: false,
          error: "Valid product ID is required",
        });
      }

      if(size_category_id == 0) {
        // tambahkan size ke table size_categories
        // Example: Insert new size into size_categories

        // Validate that size is provided when size_category_id is 0
        if (!size) {
          return res.status(400).json({
            success: false,
            error: "Size value is required when size_category_id is 0",
          });
        }

        // cek apakah size sudah ada di size_categories pada kolom custom_value_cm
        const [existingSize] = await db.promisePool.execute(
          "SELECT id FROM size_categories WHERE custom_value_cm = ?",
          [size]
        );

        if (existingSize.length > 0) {
          // Size already exists, use its ID
          size_category_id = existingSize[0].id;
          console.log("Using existing size category ID:", size_category_id);
        } else {
          // Size does not exist, create a new one
          const [result] = await db.promisePool.execute(
            "INSERT INTO size_categories (label, is_custom, custom_value_cm) VALUES (?, ?, ?)",
            [`Custom ${size} cm`, true, size]
          );

          console.log("New size category created with ID:", result.insertId);
          size_category_id = result.insertId; // Update to new size category ID
        }
      }

      // Validate size_category_id exists if provided
      if (size_category_id && size_category_id !== null && size_category_id !== 'null') {
        const [validSize] = await db.promisePool.execute(
          "SELECT id FROM size_categories WHERE id = ?",
          [size_category_id]
        );
        
        if (validSize.length === 0) {
          return res.status(400).json({
            success: false,
            error: `Invalid size_category_id: ${size_category_id} does not exist in size_categories table`,
          });
        }
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
        // Convert string 'null' to actual null
        if (size_category_id === 'null' || size_category_id === '' || size_category_id === 0) {
          size_category_id = null;
        }
        
        console.log("Setting size_category_id to:", size_category_id);
        updateFields.push("size_category_id = ?");
        updateValues.push(size_category_id);
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

  filterProduct: async function (req, res, next) {
    try {
      // Get pagination parameters from query
      const page = parseInt(req.query.page) || 1;
      const limit = 4; // Fixed limit of 4 per page (same as getAllProduct)
      const offset = (page - 1) * limit;

      // Get filter parameters
      const { size_label, age_label, search } = req.query;

      // Build WHERE clause
      let whereConditions = [];
      let queryParams = [];

      // Filter by size category label
      if (size_label && size_label.trim() !== "") {
        whereConditions.push("sc.label LIKE ?");
        queryParams.push(`%${size_label.trim()}%`);
      }

      // Filter by age category label
      if (age_label && age_label.trim() !== "") {
        whereConditions.push("ac.label LIKE ?");
        queryParams.push(`%${age_label.trim()}%`);
      }

      // Add search functionality for product name or description
      if (search && search.trim() !== "") {
        whereConditions.push("(p.name LIKE ? OR p.description LIKE ?)");
        const searchTerm = `%${search.trim()}%`;
        queryParams.push(searchTerm, searchTerm);
      }

      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

      // Get total count for pagination info
      const [countResult] = await db.promisePool.execute(
        `SELECT COUNT(*) as total 
         FROM products p
         INNER JOIN age_categories ac ON ac.id = p.age_category_id
         INNER JOIN size_categories sc ON sc.id = p.size_category_id
         ${whereClause}`,
        queryParams
      );
      const totalProducts = countResult[0].total;

      // Get filtered products with pagination
      const [products] = await db.promisePool.execute(
        `SELECT 
          p.id,
          p.name,
          p.description,
          p.price,
          p.stock,
          p.image,
          p.created_at,
          ac.label as age_range,
          ac.id as age_category_id,
          sc.label as size,
          sc.id as size_category_id,
          sc.is_custom,
          sc.custom_value_cm
         FROM products p
         INNER JOIN age_categories ac ON ac.id = p.age_category_id
         INNER JOIN size_categories sc ON sc.id = p.size_category_id
         ${whereClause}
         ORDER BY p.created_at DESC 
         LIMIT ${limit} OFFSET ${offset}`,
        queryParams
      );

      // Get available size categories for filter options
      const [sizeCategories] = await db.promisePool.execute(
        "SELECT DISTINCT label FROM size_categories ORDER BY label"
      );

      // Get available age categories for filter options
      const [ageCategories] = await db.promisePool.execute(
        "SELECT DISTINCT label FROM age_categories ORDER BY label"
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
          filters: {
            applied: {
              size_label: size_label || null,
              age_label: age_label || null,
              search: search || null,
            },
            available_options: {
              size_categories: sizeCategories.map(item => item.label),
              age_categories: ageCategories.map(item => item.label),
            },
          },
        },
      });
    } catch (error) {
      console.error("Database query error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to filter products",
      });
    }
  },

  getAllAgeCategories: async function (req, res, next) {
    try {
      // Get all age categories
      const [ageCategories] = await db.promisePool.execute(
        "SELECT id, label FROM age_categories ORDER BY id ASC"
      );
      res.json({
        success: true,
        data: {
          age_categories: ageCategories,
        },
      });
    } catch (error) {
      console.error("Database query error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch age categories",
      });
    }
  },

  getAllSizeCategories: async function (req, res, next) {
    try {
      // Get all size categories
      const [sizeCategories] = await db.promisePool.execute(
        "SELECT id, label, is_custom, custom_value_cm FROM size_categories ORDER BY id ASC"
      );

      res.json({
        success: true,
        data: {
          size_categories: sizeCategories,
        },
      });
    } catch (error) {
      console.error("Database query error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch size categories",
      });
    }
  },

  getDashboardStats: async function (req, res, next) {
    try {
      // Get total products count
      const [productCount] = await db.promisePool.execute(
        "SELECT COUNT(*) as total_products FROM products"
      );

      // Get total orders count
      const [orderCount] = await db.promisePool.execute(
        "SELECT COUNT(*) as total_orders FROM orders"
      );

      // Get total users count
      const [userCount] = await db.promisePool.execute(
        "SELECT COUNT(*) as total_users FROM users WHERE role NOT IN ('admin', 'superadmin')"
      );

      // Get revenue from completed orders (status = 'selesai')
      const [revenueResult] = await db.promisePool.execute(
        "SELECT COALESCE(SUM(total_price), 0) as total_revenue FROM orders WHERE status = 'selesai'"
      );

      
      res.json({
        success: true,
        data: {
          summary: {
            total_products: productCount[0].total_products,
            total_orders: orderCount[0].total_orders,
            total_users: userCount[0].total_users,
            total_revenue: parseFloat(revenueResult[0].total_revenue || 0),
          },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch dashboard statistics",
      });
    }
  },
};
