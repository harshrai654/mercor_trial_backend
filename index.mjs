import dotenv from "dotenv";
dotenv.config();

import express from "express";
import rateLimit from "express-rate-limit";
import bodyParser from "body-parser";
import path from "path";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";
import openai from "./openai.mjs";
import controller from "./controllers/queryController.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 2);
app.use(cookieParser());

//Rate limiting to prevent excess calling to openAI's API
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minutes
  max: 20, // Limit each IP to 10 requests per 1 minutes, as per openai free tier API rate limits
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "dist")));

app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

//User's query handler
app.post("/query", controller.processQuery);

app.get("/checkOpenAI", async (req, res) => {
  const threadId = req?.cookies?.threadId;
  /**
   * If existing thread id not found then create new thread
   * send thread id as part of cookie for subsequent calls
   */
  if (!threadId) {
    try {
      const thread = await openai.beta.threads.create();

      res.cookie("threadId", thread.id, {
        secure: true,
        sameSite: "None",
      });
      res.status(200).send("Assistant is up");
    } catch (error) {
      res.status(500).send("Assistant is down");
    }
  } else {
    res.status(200).send("Reusing previous thread");
  }
});

app.get("/refreshOpenAI", async (req, res) => {
  try {
    const thread = await openai.beta.threads.create();

    res.cookie("threadId", thread.id, {
      secure: true,
      sameSite: "None",
    });
    res.status(200).send("Assistant is up");
  } catch (error) {
    res.status(500).send("Assistant is down");
  }
});

// Start the server
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
});
