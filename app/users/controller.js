var express = require("express");
var router = express.Router();
const db = require("../../config/database");
const bcrypt = require("bcryptjs");
const { generateToken } = require("../../config/jwt");

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
};
