const { gql } = require('apollo-server-express');

// Construct a schema, using GraphQL schema language
const typeDefs = gql`
  type Query {
    hello: String
  }

  type Mutation {
    "Create a user, returns nickname"
    createUser(nickname: String!): String!
  }
`;

module.exports = typeDefs;
