const { gql } = require('apollo-server-express');

const typeDefs = gql`
  type Query {
    hello: String
  }

  type Mutation {
    "Create a user, returns user hash"
    createUser(nickname: String!): String!
    "Create a new game, returns a game hash"
    createGame(userHash: String!): String!
    "Join an existing game, returns game hash"
    joinGame(userHash: String!, gameCode: String!): String
  }
`;

module.exports = typeDefs;
