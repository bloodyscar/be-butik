var express = require("express");
var router = express.Router();
const db = require("../../config/database");
const bcrypt = require("bcryptjs");
const { generateToken } = require("../../config/jwt");

// Email validation function
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

module.exports = {
  createUsers: async function (req, res, next) {
    try {
      const { name, email, phone, password } = req.body;

      // Validate required fields
      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          error: "All fields are required: name, email, phone, password, role",
        });
      }

      // Validate email format
      if (!isValidEmail(email)) {
        return res.status(400).json({
          success: false,
          error: "Please provide a valid email address",
        });
      }

      // Hash the password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Insert new user
      const [result] = await db.promisePool.execute(
        "INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)",
        [name, email, phone, hashedPassword]
      );

      res.json({
        success: true,
        message: "User created successfully",
        data: {
          userId: result.insertId,
          name,
          email,
          phone,
        },
      });
    } catch (error) {
      console.error("Database insert error:", error);

      res.status(500).json({
        success: false,
        error: "Failed to create user",
      });
    }
  },

  loginUser: async function (req, res, next) {
    try {
      const { email, password } = req.body;

      // Validate required fields
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: "Email and password are required",
        });
      }

      // Validate email format
      if (!isValidEmail(email)) {
        return res.status(400).json({
          success: false,
          error: "Please provide a valid email address",
        });
      }

      // Find user by email
      const [users] = await db.promisePool.execute(
        "SELECT id, name, email, phone, password, role FROM users WHERE email = ?",
        [email]
      );

      if (users.length === 0) {
        return res.status(401).json({
          success: false,
          error: "Invalid email or password",
        });
      }

      const user = users[0];

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          error: "Invalid email or password",
        });
      }

      // Generate JWT token
      const token = generateToken({
        id: user.id,
        email: user.email,
        role: user.role,
      });

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;

      res.json({
        success: true,
        message: "Login successful",
        data: {
          user: userWithoutPassword,
          token,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        error: "Login failed",
      });
    }
  },

  editUsers: async function (req, res, next) {
    try {
      const userId = req.params.id;
      const { name, email, phone, password } = req.body;

      // Validate user ID
      if (!userId || isNaN(userId)) {
        return res.status(400).json({
          success: false,
          error: "Valid user ID is required",
        });
      }

      // Check if user exists
      const [existingUser] = await db.promisePool.execute(
        "SELECT * FROM users WHERE id = ?",
        [userId]
      );

      if (existingUser.length === 0) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      const currentUser = existingUser[0];

      // Prepare update data
      const updateFields = [];
      const updateValues = [];

      if (name !== undefined && name.trim() !== "") {
        updateFields.push("name = ?");
        updateValues.push(name.trim());
      }

      if (email !== undefined && email.trim() !== "") {
        // Validate email format
        if (!isValidEmail(email)) {
          return res.status(400).json({
            success: false,
            error: "Please provide a valid email address",
          });
        }

        // Check if email already exists (excluding current user)
        const [emailCheck] = await db.promisePool.execute(
          "SELECT id FROM users WHERE email = ? AND id != ?",
          [email, userId]
        );

        if (emailCheck.length > 0) {
          return res.status(400).json({
            success: false,
            error: "Email already exists",
          });
        }

        updateFields.push("email = ?");
        updateValues.push(email.trim());
      }

      if (phone !== undefined) {
        updateFields.push("phone = ?");
        updateValues.push(phone);
      }

      if (password !== undefined && password.trim() !== "") {
        // Hash the new password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        updateFields.push("password = ?");
        updateValues.push(hashedPassword);
      }

      // Check if there are any fields to update
      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No valid fields provided for update",
        });
      }

      // Add updated_at timestamp if the table has this column
      updateFields.push("updated_at = NOW()");

      // Add user ID to the end of values array for WHERE clause
      updateValues.push(userId);

      // Execute update query
      const [result] = await db.promisePool.execute(
        `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`,
        updateValues
      );

      if (result.affectedRows === 0) {
        return res.status(400).json({
          success: false,
          error: "Failed to update user",
        });
      }

      // Get updated user data (without password)
      const [updatedUser] = await db.promisePool.execute(
        "SELECT id, name, email, phone, role, created_at, updated_at FROM users WHERE id = ?",
        [userId]
      );

      res.json({
        success: true,
        message: "User updated successfully",
        data: {
          user: updatedUser[0],
          affectedRows: result.affectedRows,
        },
      });
    } catch (error) {
      console.error("Database update error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update user",
      });
    }
  },

  getAllUsers: async function (req, res, next) {
    try {
      // Get pagination parameters from query
      const page = parseInt(req.query.page) || 1;
      const limit = 10; // Fixed limit of 10 per page
      const offset = (page - 1) * limit;

      // Get search parameter if provided
      const { search } = req.query;

      // Build WHERE clause to exclude superadmin and admin roles
      let whereConditions = ["role != 'superadmin'", "role != 'admin'"];
      let queryParams = [];

      // Add search functionality
      if (search && search.trim() !== "") {
        whereConditions.push("(name LIKE ? OR email LIKE ? OR phone LIKE ?)");
        const searchTerm = `%${search.trim()}%`;
        queryParams.push(searchTerm, searchTerm, searchTerm);
      }

      const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

      // Get total count for pagination info
      const [countResult] = await db.promisePool.execute(
        `SELECT COUNT(*) as total FROM users ${whereClause}`,
        queryParams
      );
      const totalUsers = countResult[0].total;

      // Get users with pagination (excluding password)
      const [users] = await db.promisePool.execute(
        `SELECT id, name, email, phone, role, created_at, updated_at 
         FROM users 
         ${whereClause}
         ORDER BY created_at DESC 
         LIMIT ${limit} OFFSET ${offset}`,
        queryParams
      );

      // Calculate pagination metadata
      const totalPages = Math.ceil(totalUsers / limit);

      res.json({
        success: true,
        data: {
          users,
          pagination: {
            current_page: page,
            total_pages: totalPages,
            total_users: totalUsers,
            limit: limit,
            has_next: page < totalPages,
            has_prev: page > 1,
          },
          filter: {
            excluded_roles: ["superadmin", "admin"],
            search: search || null,
          },
        },
      });
    } catch (error) {
      console.error("Database query error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch users",
      });
    }
  },

  deleteUsers: async function (req, res, next) {
    try {
      const userId = req.params.id;

      // Validate user ID
      if (!userId || isNaN(userId)) {
        return res.status(400).json({
          success: false,
          error: "Valid user ID is required",
        });
      }

      // Check if user exists
      const [existingUser] = await db.promisePool.execute(
        "SELECT id, name, email FROM users WHERE id = ?",
        [userId]
      );

      if (existingUser.length === 0) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      const user = existingUser[0];

      // Start transaction to ensure data consistency
      const connection = await db.promisePool.getConnection();
      await connection.beginTransaction();

      try {
        // Delete related records first to avoid foreign key constraint issues
        
        // 1. Delete from order_items table (via orders)
        await connection.execute(
          `DELETE oi FROM order_items oi 
           INNER JOIN orders o ON oi.order_id = o.id 
           WHERE o.user_id = ?`,
          [userId]
        );

        // 2. Delete from orders table
        const [ordersResult] = await connection.execute(
          "DELETE FROM orders WHERE user_id = ?",
          [userId]
        );

        // 3. Add any other tables that reference this user
        // Example: DELETE FROM user_sessions WHERE user_id = ?
        // Example: DELETE FROM user_preferences WHERE user_id = ?

        // Finally, delete the user itself
        const [result] = await connection.execute(
          "DELETE FROM users WHERE id = ?",
          [userId]
        );

        // Commit the transaction
        await connection.commit();
        connection.release();

        res.json({
          success: true,
          message: "User and all related records deleted successfully",
          data: {
            deletedUserId: userId,
            deletedUserName: user.name,
            deletedUserEmail: user.email,
            affectedRows: result.affectedRows,
            deletedOrders: ordersResult.affectedRows,
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
        error: "Failed to delete user",
      });
    }
  },
};
