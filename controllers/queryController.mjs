import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import xss from "xss";
import util from "util";
import pool from "../db.mjs";

const secretKey = process.env.OPENAI_API_KEY;
const assistantId = process.env.ASSISTANT_ID;
const pollingInterval = process.env.POLLING_INTERVAL;
const openai = new OpenAI({
  apiKey: secretKey,
});

export default {
  async processQuery(req, res) {
    const thread = await openai.beta.threads.create();
    try {
      const query = xss(req.body?.query?.text);
      await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: query,
      });

      const run = await openai.beta.threads.runs.create(thread.id, {
        assistant_id: assistantId,
      });

      // Imediately fetch run-status, which will be "in_progress"
      let runStatus = await openai.beta.threads.runs.retrieve(
        thread.id,
        run.id
      );

      while (runStatus.status !== "completed") {
        await new Promise((resolve) => setTimeout(resolve, pollingInterval));
        runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

        if (runStatus.status === "requires_action") {
          const toolCalls =
            runStatus.required_action.submit_tool_outputs.tool_calls;
          const toolOutputs = [];

          for (const toolCall of toolCalls) {
            const functionName = toolCall.function.name;

            console.log(
              `This question requires us to call a function: ${functionName}`
            );

            const args = JSON.parse(toolCall.function.arguments);

            const argsArray = Object.keys(args).map((key) => args[key]);

            // Dynamically call the function with function name and arguments
            const output = await tools[functionName].apply(null, [args]);

            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(output),
            });
          }
          // Submit tool outputs
          await openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, {
            tool_outputs: toolOutputs,
          });
          continue; // Continue polling for the final response
        }

        // Check for failed, cancelled, or expired status
        if (["failed", "cancelled", "expired"].includes(runStatus.status)) {
          console.log(
            `Run status is '${runStatus.status}'. Unable to complete the request.`
          );
          res.send({
            text: "I am having trouble understanding the request",
            role: "bot",
          });
          break; // Exit the loop if the status indicates a failure or cancellation
        }
      }

      // Get the last assistant message from the messages array
      const messages = await openai.beta.threads.messages.list(thread.id);

      // Find the last message for the current run
      const lastMessageForRun = messages.data
        .filter(
          (message) => message.run_id === run.id && message.role === "assistant"
        )
        .pop();

      // If an assistant message is found, console.log() it
      if (lastMessageForRun) {
        res.send({
          text: lastMessageForRun.content[0].text.value,
          role: "bot",
        });
      } else if (
        !["failed", "cancelled", "expired"].includes(runStatus.status)
      ) {
        res.send({
          text: "I am having trouble understanding the request",
          role: "bot",
        });
      }
    } catch (error) {
      console.log(error);
      res.send({
        text: "Something went wrong on my end!!",
        role: "bot",
      });
    }
  },
};

const tools = {
  async fetchCandidates(data) {
    //jobType = 0 (part time)
    //jobType = 1 (full time)
    const defaultValues = {
      jobType: true,
      budget: 10000000,
      skills: [
        "speech generation",
        "audio generation",
        "web scraping",
        "adobe",
        "aws",
        "azure",
        "bootstrap",
        "c",
        "c++",
        "c#",
        "computer vision",
        "docker",
        "django",
        "excel",
        "express.js",
        "figma",
        "flutter",
        "gcp",
        "go",
        "graphql",
        "html/css",
        "java",
        "javascript",
        "kotlin",
        "large language models",
        "laravel",
        "nlp",
        "next.js",
        "node.js",
        "nosql",
        "php",
        "powerpoint",
        "python",
        "react",
        "react native",
        "redux",
        "ruby",
        "ruby on rails",
        "r",
        "rust",
        "sql",
        "spring",
        "swift",
        "swift ui",
        "svelte",
        "typescript",
        "vue.js",
        "kubernetes",
      ],
    };
    const topK = 4;
    let { jobType, budget, skills } = data;

    console.log(`function fetchCandidates called with arguments`);
    console.log(util.inspect(data));

    try {
      // Validate and convert parameters to valid data types
      const validatedData = {
        validatedJobType:
          typeof jobType === "string"
            ? jobType.toLowerCase() === "full time"
              ? true
              : false
            : defaultValues.jobType,
        validatedBudget: Number(budget) ? Number(budget) : defaultValues.budget,
      };

      if (typeof skills === "string") {
        skills = skills.toLowerCase().split(",");
        const skillSet = new Set(defaultValues.skills);
        if (!skills.some((s) => skillSet.has(s))) {
          validatedData.validatedSkills = defaultValues.skills;
        } else {
          validatedData.validatedSkills = skills;
        }
      } else {
        validatedData.validatedSkills = defaultValues.skills;
      }

      validatedData.validatedSkills = validatedData.validatedSkills.map(
        (skill) => `'${skill}'`
      );

      const candidates = await new Promise((resolve, reject) => {
        pool.query(
          `SELECT DISTINCT mu.* from MercorUsers AS mu LEFT JOIN MercorUserSkills AS mus ON mu.userId = mus.userId LEFT JOIN Skills s ON mus.skillId = mus.skillId WHERE mu.fullTime=${
            validatedData.validatedJobType
          } AND (mu.fullTimeSalary IS NULL OR CAST(mu.fullTimeSalary AS SIGNED) <= ${
            validatedData.validatedBudget
          }) AND s.skillName IN (${validatedData.validatedSkills.join(
            ","
          )}) LIMIT ${topK};`,
          (error, result) => {
            if (error) {
              return reject(error);
            }
            resolve(result);
          }
        );
      });

      return candidates;
    } catch (error) {
      console.error("Error fetching candidates:", error);
      return {
        success: false,
      };
    }
  },

  fetchCandidatesFromSemantics(inputQuery) {},
};
