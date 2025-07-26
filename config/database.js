const mysql = require("mysql2");

// Create a connection pool for better performance
const pool = mysql.createPool({
  host: "localhost",
  user: "root", // Change this to your MySQL username
  password: "", // Change this to your MySQL password
  database: "butik", // Change this to your database name
  port: 3306, // Default MySQL port
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
});

// Get promisified version for async/await support
const promisePool = pool.promise();

// Test the connection
const testConnection = async () => {
  try {
    const [rows] = await promisePool.execute("SELECT 1 as test");
    console.log("✅ Database connected successfully");
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
    return false;
  }
};

module.exports = {
  pool,
  promisePool,
  testConnection,
};
