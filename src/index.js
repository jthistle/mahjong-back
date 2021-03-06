require('dotenv').config();

const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const { express: voyagerMiddleware } = require('graphql-voyager/middleware');
const cors = require('cors');
const path = require('path');

const gameManager = require('./gameManager.js');
const typeDefs = require('./schema.js');
const resolvers = require('./resolvers.js');

const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
});

const app = express();

app.options('*', cors());
app.use(cors());

if (process.env.NODE_ENV === 'production') {
  console.log('In production, serving from static');
  app.use(express.static(path.join(__dirname, 'client')));
}

server.applyMiddleware({
  app,
});

app.use('/voyager', voyagerMiddleware({ endpointUrl: '/graphql' }));

/* declare last as a catchall */
app.get('/*', function (req, res) {
  res.sendFile(path.join(__dirname, 'client/index.html'), function (err) {
    if (err) {
      res.status(500).send(err);
    }
  });
});

const port = process.env.PORT || 4000;
app.listen({ port }, () => console.log(`Server ready on port ${port}!`));

gameManager.run();
