require('dotenv').config();

const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const { express: voyagerMiddleware } = require('graphql-voyager/middleware');
const cors = require('cors');
const path = require('path');

const gameManager = require('./gameManager.js');
const typeDefs = require('./schema.js');
const resolvers = require('./resolvers.js');

const server = new ApolloServer({ typeDefs, resolvers });

const app = express();

app.options('*', cors());
app.use(cors());

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/build')));
}

server.applyMiddleware({
  app,
});

app.use('/voyager', voyagerMiddleware({ endpointUrl: '/graphql' }));

app.listen({ port: process.env.PORT || 4000 }, () =>
  console.log(`Server ready!`)
);

gameManager.run();
