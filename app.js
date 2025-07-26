var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");

var usersRouter = require("./app/users/routes.js");
var productsRouter = require("./app/products/routes.js");
var ordersRouter = require("./app/orders/routes.js");
var cartRouter = require("./app/cart/routes.js");

// Database connection
const db = require("./config/database");

var app = express();

// Serve folder public sebagai static
app.use("/public", express.static(path.join(__dirname, "public")));

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/users", usersRouter);
app.use("/products", productsRouter);
app.use("/orders", ordersRouter);
app.use("/cart", cartRouter);

// Initialize database connection
db.testConnection();

module.exports = app;
