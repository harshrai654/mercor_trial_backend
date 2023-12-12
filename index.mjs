import dotenv from "dotenv";
dotenv.config();

import express from "express";
import rateLimit from "express-rate-limit";
import bodyParser from "body-parser";
import controller from "./controllers/queryController.mjs";

const app = express();

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minutes
  max: 50, // Limit each IP to 50 requests per `window` (here, per 1 minutes)
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

app.use(bodyParser.json());

app.post("/query", controller.processQuery);

// Start the server
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
});
