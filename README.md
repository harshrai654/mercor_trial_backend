# Mercor Trial Backend

The project follows a Microservice architecture which follows a lightweight NodeJS API which works as the first point of contact for the chat UI.

## Architecture

![Chat bot architecture](https://raw.githubusercontent.com/harshrai654/mercor_trial_backend/master/mercor-trial%20architecture.png)

Request-Response Flow
1. The user's request is received by the NodeJS API, which acts as the entry point for the chat UI.
2. The request is forwarded to OpenAI Assistant API
3. OpenAI responds with a function to be called along with arguments
4. Depending upon the type of function to be called Either a MySQL query is performed (scalar component search) OR an API request is sent to a Python server hosted in a GCP virtual machine.
5. Python server converts query(semantic component) into vector embeddings to do similarity comparison with Pinecone DB.
    1. Pinecone DB is already populated with MySQL Database where each user’s information is fetched from DB, converted to vector embeddings using “sentence-transformers” and inserted into the pinecone vector database
6. The result of the function call is fed back to OpenAI assistant to format the final response for the user
7. The final response is sent back to the user from the NodeJS API

