import dotenv from "dotenv";
dotenv.config();

import mysql from "mysql2";

const pool = mysql.createPool({
  connectionLimit: process.env.DB_POOL,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_SCHEMA,
});

export default pool;
