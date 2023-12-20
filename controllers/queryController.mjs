import dotenv from "dotenv";
dotenv.config();

import xss from "xss";
import util from "util";
import axios from "axios";
import openai from "../openai.mjs";
import pool from "../db.mjs";

//Environment variables
const assistantId = process.env.ASSISTANT_ID; //Open AI assistant
const pollingInterval = process.env.POLLING_INTERVAL; //Run status check polling interval
const semnaticServiceEnpoint = process.env.SEMANTIC_SERVICE_ENDPOINT; //Semnatic search service endpoint
const topK = process.env.MATCH_COUNT; //Number of candidates to match

export default {
  //This function is used to handle POST request to /query endpoint
  async processQuery(req, res) {
    const threadId = req?.cookies?.threadId;
    let run = "";
    //If no thread id found then do not proceed, and send error
    if (!threadId) {
      return res.status(400).send("Thread ID not found!!");
    }
    console.log(`Thread ID already exists: ${threadId}`);
    try {
      const query = xss(req.body?.query?.text);

      //Append user's query into thread
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: query,
      });

      //Run thread against assistant
      run = await openai.beta.threads.runs.create(threadId, {
        assistant_id: assistantId,
      });

      // Imediately fetch run-status, which will be "in_progress"
      let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);

      /**
       * Right now streaming API is not present so we need to poll
       * To check for current run status
       */
      while (runStatus.status !== "completed") {
        await new Promise((resolve) => setTimeout(resolve, pollingInterval));
        runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);

        //Function calling handler
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
            console.log(args);
            // Dynamically call the function with function name and arguments
            const output = await tools[functionName].apply(null, [args]);

            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(output),
            });
          }
          // Submit tool outputs
          await openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
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
      const messages = await openai.beta.threads.messages.list(threadId);

      // Find the last message for the current run
      const lastMessageForRun = messages.data
        .filter(
          (message) => message.run_id === run.id && message.role === "assistant"
        )
        .pop();

      if (lastMessageForRun) {
        console.log(lastMessageForRun.content[0].text.value);
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
      await openai.beta.threads.runs.cancel(threadId, run.id);
      res.send({
        text: "Something went wrong on my end!!",
        role: "bot",
      });
    }
  },
};

const tools = {
  /**
   * This function fetches candidates data against user's scaler query part
   * @param {<jobType, budget, skills>} data - Arguments passed by assistant
   * @returns Conadidates data from MySQL DB
   */
  async fetchCandidatesWithScalerQuery(data) {
    let { jobType, budget, skills, semanticComponent } = data;

    console.log(`function fetchCandidates called with arguments`);
    console.log(util.inspect(data));

    const response = { message: "" };
    try {
      // Validate and convert parameters to valid data types
      const validatedData = {
        validatedJobType: null,
        validatedBudget: null,
        validatedSkills: null,
      };

      //Validate job type argument
      if (typeof jobType === "string") {
        jobType = jobType.toLowerCase();
        if (jobType === "full time") {
          validatedData.validatedJobType = "True";
        } else if (jobType === "part time") {
          validatedData.validatedJobType = "False";
        }
      }

      //Validate budget argument
      if (typeof budget === "number") {
        validatedData.validatedBudget = budget;
      }

      //Validate skills argument
      if (typeof skills === "string") {
        skills = skills
          .split(",")
          .map((skill) => `'${skill}'`)
          .join(",");
        validatedData.validatedSkills = skills;
      }

      //Attaching next set of instructions after searching scaler part of query
      //Tried to create a chain of scaler + semantic search for a query, right now its just combines results
      //From both the function calls but desired result is to have intersection of results from scaler +
      //Semantic search.
      //response.message works as feedback OR next steps for assistant
      if (semanticComponent) {
        response.message = `Call fetchCandidatesWithSemanticQuery with query: ${semanticComponent} and combine the results with current candidates(if present) before showing the final response`;
      } else {
        response.message = `Call fetchCandidatesWithSemanticQuery by forming 'query' argument by combinign current scaler arguments in natural language`;
      }

      //Where Caluse generator accordind to validated Data
      let whereClause = "";
      if (validatedData.validatedJobType !== null) {
        //jobType condition is present
        whereClause += `WHERE mu.fullTime = ${validatedData.validatedJobType}`;

        if (validatedData.validatedBudget) {
          //jobType + budget is present
          whereClause += ` AND ${
            validatedData.validatedJobType === "False"
              ? " (mu.partTimeSalary IS NULL OR CAST(mu.partTimeSalary AS SIGNED) "
              : " (mu.fullTimeSalary IS NULL OR CAST(mu.fullTimeSalary AS SIGNED) "
          } <= ${validatedData.validatedBudget})`;
        }
      } else if (validatedData.validatedBudget) {
        //onlu budget is present
        whereClause += `WHERE mu.fullTimeSalary IS NULL OR CAST(mu.fullTimeSalary AS SIGNED) <= ${validatedData.validatedBudget}`; //Considering fullTimeSalary if jobType is not defined
      } else if (validatedData.validatedSkills === null) {
        return response;
      }

      console.log(`WHERE clause generated: ${whereClause}`);

      //Order By Clause generator
      let orderByClause = "";

      if (validatedData.validatedSkills !== null) {
        orderByClause += "ORDER BY matchedSkillsCount DESC, ";
      } else {
        orderByClause += "ORDER BY ";
      }

      if (validatedData.validatedJobType === "False") {
        orderByClause += "mu.partTimeSalary ASC ";
      } else {
        orderByClause += "mu.fullTimeSalary ASC ";
      }

      console.log(`ORDER clause generated: ${orderByClause}`);

      //Query MySQL DB according to provided data
      const candidates = await new Promise((resolve, reject) => {
        pool.query(
          `SELECT
              mu.*,
              GROUP_CONCAT(DISTINCT s.skillName) AS allSkills
              ${
                validatedData.validatedSkills
                  ? `, COUNT(CASE WHEN s.skillName IN (${validatedData.validatedSkills}) THEN 1 END) AS matchedSkillsCount`
                  : ""
              }
          FROM
              MercorUsers AS mu
          LEFT JOIN MercorUserSkills AS mus ON mu.userId = mus.userId
          LEFT JOIN Skills AS s ON s.skillId = mus.skillId
          ${whereClause}
          GROUP BY
              mu.userId
          ${orderByClause}
          LIMIT
              ${topK};`,
          (error, result) => {
            if (error) {
              return reject(error);
            }
            resolve(result);
          }
        );
      });

      return {
        ...response,
        candidates,
      };
    } catch (error) {
      console.error("Error fetching candidates from scaler query:", error);
      return {
        ...response,
        success: false,
      };
    }
  },

  /**
   *
   * @param {String} inputQuery - Semantic part of user's query
   * @returns Candidates data from semantic-service
   */
  async fetchCandidatesWithSemanticQuery(inputQuery) {
    console.log(
      `function fetchCandidatesWithSemanticQuery called with argument`
    );
    console.log(inputQuery);
    inputQuery.topK = topK;
    try {
      //POST request to semantic-service to get candidates data
      const users = await axios.post(semnaticServiceEnpoint, inputQuery);
      return {
        candidates: users.data,
        message:
          "Call fetchCandidatesWithScalerQuery if required, and atleast one of the non-semantic argument is availabel",
      };
    } catch (error) {
      console.error("Error fetching candidates from semantic query:", error);
      return {
        success: false,
      };
    }
  },
};
